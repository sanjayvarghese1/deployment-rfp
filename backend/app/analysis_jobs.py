from __future__ import annotations

import asyncio
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
class AnalysisJobState:
    id: str
    contract_id: str
    status: str = "queued"
    progress: str | None = "Queued for analysis"
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    request: dict[str, Any] | None = None


_jobs: dict[str, AnalysisJobState] = {}
_job_store = JobStore(settings.job_store_path)


def _to_store(job: AnalysisJobState) -> StoredJob:
    return StoredJob(
        job_id=job.id,
        kind="analysis",
        status=job.status,
        progress={"message": job.progress} if job.progress else None,
        result=job.result,
        pdf_base64=None,
        decomposition=None,
        error=job.error,
        request=job.request,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _from_store(stored: StoredJob) -> AnalysisJobState:
    progress = stored.progress.get("message") if stored.progress else None
    return AnalysisJobState(
        id=stored.job_id,
        contract_id=str((stored.request or {}).get("contract_id") or stored.job_id),
        status=stored.status,
        progress=progress,
        result=stored.result,
        error=stored.error,
        created_at=stored.created_at,
        updated_at=stored.updated_at,
        request=stored.request,
    )


def create_analysis_job(input: dict[str, Any], origin: str) -> AnalysisJobState:
    contract_id = str(input["contract_id"])
    job = AnalysisJobState(id=uuid4().hex, contract_id=contract_id, request=input)
    _jobs[job.id] = job
    _job_store.upsert_job(_to_store(job))
    asyncio.create_task(_run_background_analysis(job.id, origin, input))
    return job


def get_analysis_job(job_id: str) -> AnalysisJobState | None:
    job = _jobs.get(job_id)
    if job:
        return job

    stored = _job_store.get_job(job_id)
    if not stored or stored.kind != "analysis":
        return None

    restored = _from_store(stored)
    _jobs[job_id] = restored
    return restored


def update_analysis_job(job_id: str, **patch: Any) -> AnalysisJobState | None:
    current = get_analysis_job(job_id)
    if not current:
        return None

    updated = AnalysisJobState(
        id=current.id,
        contract_id=current.contract_id,
        status=str(patch.get("status", current.status)),
        progress=patch.get("progress", current.progress),
        result=patch.get("result", current.result),
        error=patch.get("error", current.error),
        created_at=current.created_at,
        updated_at=_now(),
        request=patch.get("request", current.request),
    )
    _jobs[job_id] = updated
    _job_store.upsert_job(_to_store(updated))
    return updated


async def _run_background_analysis(job_id: str, origin: str, body: dict[str, Any]) -> None:
    remote_url = settings.frontend_base_url.rstrip("/") + "/api/ai/analyze-proposal"

    try:
        update_analysis_job(job_id, status="running", progress="Starting analysis...")

        async with httpx.AsyncClient(timeout=None) as client:
            response = await client.post(
                remote_url,
                json={
                    "mode": "full_pipeline",
                    "contract_id": body.get("contract_id"),
                    "contract_title": (body.get("contract") or {}).get("title"),
                    "contract_description": (body.get("contract") or {}).get("description"),
                    "contract_budget": (body.get("contract") or {}).get("budget"),
                    "contract_deadline": (body.get("contract") or {}).get("deadline"),
                    "contract_certifications": (body.get("contract") or {}).get("certifications"),
                    "vendors": body.get("vendors") or [],
                    "mandatoryCriteria": body.get("mandatoryCriteria"),
                    "fastMode": True,
                },
            )
            response.raise_for_status()
            data = response.json()
            update_analysis_job(job_id, status="completed", progress="Analysis complete", result=data)
    except Exception as error:  # noqa: BLE001
        update_analysis_job(job_id, status="failed", progress="Analysis failed", error=str(error))


def serialize_job(job: AnalysisJobState) -> dict[str, Any]:
    return asdict(job)
