from __future__ import annotations

import asyncio
from pathlib import Path

import app.rfp_jobs as rfp_jobs
from app.job_store import JobStore


def test_create_and_restore_rfp_job(tmp_path: Path, monkeypatch) -> None:
    store = JobStore(str(tmp_path / "rfp_jobs.sqlite3"))
    monkeypatch.setattr(rfp_jobs, "_job_store", store)
    rfp_jobs._jobs.clear()

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(asyncio, "create_task", fake_create_task)

    job = rfp_jobs.create_rfp_job(
        {
            "organization_name": "Acme Corp",
            "project_title": "ProcureNet",
            "category": "software",
            "sections": {"executive_summary": "Summary"},
            "detailed_project_description": "Build it",
        },
        fast_mode=True,
    )

    assert job.job_id
    assert rfp_jobs.get_rfp_job(job.job_id) is job

    rfp_jobs._jobs.clear()
    restored = rfp_jobs.get_rfp_job(job.job_id)

    assert restored is not None
    assert restored.job_id == job.job_id
    assert restored.status == "queued"
