"""
Langfuse configuration for backend API cost tracking.
Initializes Langfuse client from environment variables for tracing API calls.
"""

import os
from typing import Optional


class LangfuseConfig:
    """Langfuse configuration from environment variables."""

    secret_key: Optional[str] = os.getenv("LANGFUSE_SECRET_KEY")
    public_key: Optional[str] = os.getenv("LANGFUSE_PUBLIC_KEY")
    base_url: Optional[str] = os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")

    @staticmethod
    def is_configured() -> bool:
        """Check if Langfuse is properly configured."""
        return bool(LangfuseConfig.secret_key and LangfuseConfig.public_key)

    @staticmethod
    def get_client():
        """Get Langfuse client instance."""
        if not LangfuseConfig.is_configured():
            return None

        try:
            from langfuse import Langfuse

            return Langfuse(
                secret_key=LangfuseConfig.secret_key,
                public_key=LangfuseConfig.public_key,
                base_url=LangfuseConfig.base_url,
            )
        except ImportError:
            print("[Langfuse] langfuse package not installed")
            return None


# Global Langfuse client instance
_langfuse_client = None


def get_langfuse_client():
    """Get or create Langfuse client."""
    global _langfuse_client

    if _langfuse_client is not None:
        return _langfuse_client

    _langfuse_client = LangfuseConfig.get_client()

    if _langfuse_client:
        print(
            f"[Langfuse] Client initialized with base_url={LangfuseConfig.base_url}"
        )
    else:
        print("[Langfuse] Client not initialized (missing credentials or package)")

    return _langfuse_client


async def flush_langfuse():
    """Flush all pending traces to Langfuse."""
    client = get_langfuse_client()
    if client:
        try:
            await client.flush_async()
        except Exception as e:
            print(f"[Langfuse] Error flushing: {e}")
