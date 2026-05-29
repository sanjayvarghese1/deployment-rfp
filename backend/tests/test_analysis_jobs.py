from __future__ import annotations

import asyncio
from pathlib import Path

import app.analysis_jobs as analysis_jobs
from app.job_store import JobStore


def test_create_and_restore_analysis_job(tmp_path: Path, monkeypatch) -> None:
    store = JobStore(str(tmp_path / "analysis_jobs.sqlite3"))
    monkeypatch.setattr(analysis_jobs, "_job_store", store)
    analysis_jobs._jobs.clear()

    def fake_create_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(asyncio, "create_task", fake_create_task)

    job = analysis_jobs.create_analysis_job(
        {
            "contract_id": "contract-1",
            "contract": {"title": "Contract", "description": "Desc"},
            "vendors": [{"name": "Vendor A"}],
        },
        origin="http://testserver",
    )

    assert job.id
    assert analysis_jobs.get_analysis_job(job.id) is job

    analysis_jobs._jobs.clear()
    restored = analysis_jobs.get_analysis_job(job.id)

    assert restored is not None
    assert restored.id == job.id
    assert restored.contract_id == "contract-1"
