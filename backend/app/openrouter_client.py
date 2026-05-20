"""
OpenRouter API client with Langfuse integration for backend API.
Handles LLM calls with token tracking and cost estimation.
"""

import os
import json
import httpx
import asyncio
from typing import Any, Optional, Dict
from datetime import datetime

from .langfuse_config import get_langfuse_client, flush_langfuse

# Configuration
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

OPENROUTER_PRIMARY_MODEL = os.getenv(
    "OPENROUTER_PRIMARY_MODEL",
    "qwen/qwen-plus-2025-2025-01-25",
)
OPENROUTER_FALLBACK_MODEL = os.getenv(
    "OPENROUTER_FALLBACK_MODEL",
    "qwen/qwen-plus-2025-2025-01-25",
)

# Model pricing per 1K tokens (USD) - matches frontend
MODEL_PRICING = {
    # Qwen Plus series
    "qwen/qwen-plus-2025-2025-01-25": {"input": 0.0004, "output": 0.0012},
    "qwen/qwen-plus": {"input": 0.0004, "output": 0.0012},
    # Qwen Turbo series
    "qwen/qwen-turbo": {"input": 0.0002, "output": 0.0006},
    # Qwen 3 Max
    "qwen/qwen3-max": {"input": 0.002, "output": 0.006},
    # Qwen 3 Vision
    "qwen/qwen3-32b-vision": {"input": 0.0008, "output": 0.0024},
    "qwen/qwen3-vision": {"input": 0.001, "output": 0.003},
    # Qwen 32B
    "qwen/qwen-32b": {"input": 0.0008, "output": 0.0024},
}


class CostBreakdown:
    """Cost breakdown for API usage."""

    def __init__(self, input_cost: float, output_cost: float):
        self.input = round(input_cost, 6)
        self.output = round(output_cost, 6)
        self.total = round(input_cost + output_cost, 6)

    def to_dict(self) -> Dict[str, float]:
        return {"input": self.input, "output": self.output, "total": self.total}


def estimate_cost(model: str, usage: Optional[Dict[str, int]]) -> CostBreakdown:
    """Estimate cost for API call based on token usage."""
    if not usage:
        return CostBreakdown(0, 0)

    pricing = MODEL_PRICING.get(model)

    if not pricing:
        print(
            f"[OpenRouter] No pricing found for model {model}. Cost will show as 0."
        )
        return CostBreakdown(0, 0)

    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)

    input_cost = (prompt_tokens / 1000) * pricing["input"]
    output_cost = (completion_tokens / 1000) * pricing["output"]

    return CostBreakdown(input_cost, output_cost)


async def call_openrouter(
    payload: Dict[str, Any], timeout_seconds: int = 90
) -> Dict[str, Any]:
    """Call OpenRouter API with the given payload."""
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        try:
            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
            )

            if response.status_code != 200:
                raise Exception(
                    f"OpenRouter error ({response.status_code}): {response.text}"
                )

            return response.json()

        except httpx.TimeoutException:
            raise Exception(f"OpenRouter request timeout after {timeout_seconds}s")
        except httpx.RequestError as e:
            raise Exception(f"OpenRouter request failed: {str(e)}")


async def openrouter_chat(
    messages: list[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.5,
    max_tokens: int = 2048,
    response_format: Optional[Dict[str, Any]] = None,
    trace_name: str = "OpenRouter Chat",
) -> Dict[str, Any]:
    """
    Call OpenRouter API and trace with Langfuse.
    Returns dict with 'content', 'usage', and 'cost' keys.
    """
    selected_model = model or OPENROUTER_PRIMARY_MODEL
    fallback_model = OPENROUTER_FALLBACK_MODEL

    # Initialize Langfuse trace
    langfuse_client = get_langfuse_client()
    trace = None
    if langfuse_client:
        trace = langfuse_client.trace(
            name=trace_name,
            metadata={
                "modelRequested": selected_model,
                "fallbackModel": fallback_model,
                "provider": "openrouter",
                "messageCount": len(messages),
            },
        )

    # Normalize messages
    normalized_messages = messages
    if not any(m.get("role") == "system" for m in messages):
        normalized_messages = [
            {"role": "system", "content": "You are an expert RFP analysis assistant."},
            *messages,
        ]

    payload = {
        "model": selected_model,
        "messages": normalized_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    if response_format:
        payload["response_format"] = response_format

    try:
        # Call API
        response_data = await call_openrouter(payload)

        content = (
            response_data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

        if not content:
            raise ValueError("Empty model response")

        # Extract usage
        usage = response_data.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)

        # Calculate cost
        cost_breakdown = estimate_cost(selected_model, usage)

        # Log to Langfuse
        if trace:
            generation = trace.generation(
                name="chat_completion",
                model=selected_model,
                input={"messageCount": len(messages), "maxTokens": max_tokens},
            )

            generation.end(
                output={"contentLength": len(content)},
                usage={
                    "input": prompt_tokens,
                    "output": completion_tokens,
                },
                cost={
                    "input": cost_breakdown.input,
                    "output": cost_breakdown.output,
                    "total": cost_breakdown.total,
                },
                metadata={
                    "modelUsed": selected_model,
                    "estimatedCostUsd": cost_breakdown.total,
                    "costBreakdown": {
                        "input": cost_breakdown.input,
                        "output": cost_breakdown.output,
                    },
                },
            )

            await flush_langfuse()

        return {
            "content": content,
            "usage": {"input": prompt_tokens, "output": completion_tokens},
            "cost": cost_breakdown.total,
            "cost_breakdown": cost_breakdown.to_dict(),
        }

    except Exception as e:
        # Log error to Langfuse
        if trace:
            generation = trace.generation(
                name="chat_completion_error",
                model=selected_model,
                input={"messageCount": len(messages), "maxTokens": max_tokens},
            )

            generation.end(
                level="ERROR",
                status_message=str(e),
                metadata={"modelUsed": selected_model},
            )

            await flush_langfuse()

        print(f"[OpenRouter] Error: {str(e)}")
        raise


async def openrouter_chat_json(
    messages: list[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.5,
    max_tokens: int = 2048,
    trace_name: str = "OpenRouter JSON Chat",
) -> Dict[str, Any]:
    """
    Call OpenRouter API requesting JSON format and parse response.
    Returns parsed JSON with cost tracking.
    """
    response_format = {"type": "json_object"}

    result = await openrouter_chat(
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format=response_format,
        trace_name=trace_name,
    )

    try:
        parsed = json.loads(result["content"])
        result["parsed"] = parsed
        return result
    except json.JSONDecodeError as e:
        print(f"[OpenRouter] Failed to parse JSON response: {str(e)}")
        raise ValueError(f"Failed to parse JSON response: {result['content']}")
