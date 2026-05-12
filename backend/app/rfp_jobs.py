from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx

from .job_store import JobStore, StoredJob
from .settings import settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RfpJobState:
    job_id: str
    status: str = "queued"
    progress: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    pdf_base64: str | None = None
    decomposition: dict[str, Any] | None = None
    error: str | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


_jobs: dict[str, RfpJobState] = {}
_job_store = JobStore(settings.job_store_path)


def create_rfp_job(payload: dict[str, Any], fast_mode: bool = True) -> RfpJobState:
    job = RfpJobState(job_id=uuid4().hex)
    _jobs[job.job_id] = job
    _job_store.upsert_job(
        StoredJob(
            job_id=job.job_id,
            kind="rfp",
            status=job.status,
            progress=job.progress,
            result=job.result,
            pdf_base64=job.pdf_base64,
            decomposition=job.decomposition,
            error=job.error,
            request=payload,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )
    )
    asyncio.create_task(_run_rfp_job(job.job_id, payload, fast_mode))
    return job


def get_rfp_job(job_id: str) -> RfpJobState | None:
    job = _jobs.get(job_id)
    if job:
        return job

    stored = _job_store.get_job(job_id)
    if not stored or stored.kind != "rfp":
        return None

    restored = RfpJobState(
        job_id=stored.job_id,
        status=stored.status,
        progress=stored.progress,
        result=stored.result,
        pdf_base64=stored.pdf_base64,
        decomposition=stored.decomposition,
        error=stored.error,
        created_at=stored.created_at,
        updated_at=stored.updated_at,
    )
    _jobs[job_id] = restored
    return restored


def _update_job(job_id: str, **patch: Any) -> None:
    job = _jobs[job_id]
    for key, value in patch.items():
        setattr(job, key, value)
    job.updated_at = _now()
    _job_store.upsert_job(
        StoredJob(
            job_id=job.job_id,
            kind="rfp",
            status=job.status,
            progress=job.progress,
            result=job.result,
            pdf_base64=job.pdf_base64,
            decomposition=job.decomposition,
            error=job.error,
            request=None,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )
    )


async def _run_rfp_job(job_id: str, payload: dict[str, Any], fast_mode: bool) -> None:
    frontend_url = settings.frontend_base_url.rstrip("/") + "/api/rfp/generate"
    request_payload = {**payload, "fastMode": fast_mode}

    try:
        _update_job(job_id, status="running", progress={"message": "Queued for generation"})
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", frontend_url, json=request_payload) as response:
                response.raise_for_status()
                buffer = ""

                async for chunk in response.aiter_text():
                    buffer += chunk
                    parts = buffer.split("\n\n")
                    buffer = parts.pop() or ""

                    for event in parts:
                        event_type = ""
                        data_str = ""
                        for line in event.split("\n"):
                            if line.startswith("event: "):
                                event_type = line[7:]
                            elif line.startswith("data: "):
                                data_str = line[6:]

                        if not event_type or not data_str:
                            continue

                        data = json.loads(data_str)
                        if event_type == "progress":
                            _update_job(job_id, progress=data)
                        elif event_type == "result":
                            _update_job(job_id, result=data)
                        elif event_type == "pdf":
                            _update_job(job_id, pdf_base64=data.get("pdfBase64"))
                        elif event_type == "subsystem_pdf":
                            existing = _jobs[job_id].decomposition or {"subsystemPdfs": [], "subsystemDrafts": []}
                            existing.setdefault("subsystemPdfs", []).append(data)
                            _update_job(job_id, decomposition=existing)
                        elif event_type == "subsystem_draft":
                            existing = _jobs[job_id].decomposition or {"subsystemPdfs": [], "subsystemDrafts": []}
                            existing.setdefault("subsystemDrafts", []).append(data)
                            _update_job(job_id, decomposition=existing)
                        elif event_type == "error":
                            raise RuntimeError(data.get("message") or "Generation failed")

        job = _jobs[job_id]
        if not job.result or not job.pdf_base64:
            raise RuntimeError("Generation finished without a result")

        _update_job(job_id, status="completed", progress={"message": "Analysis complete"})
    except Exception as exc:  # noqa: BLE001
        _update_job(job_id, status="failed", error=str(exc), progress={"message": "Analysis failed"})


def serialize_job(job: RfpJobState) -> dict[str, Any]:
    return asdict(job)
