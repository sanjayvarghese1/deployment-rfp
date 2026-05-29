from datetime import datetime, timezone
from pathlib import Path

from app.job_store import JobStore, StoredJob


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_job_store_round_trip(tmp_path: Path) -> None:
    store = JobStore(str(tmp_path / "jobs.sqlite3"))
    job = StoredJob(
        job_id="job-1",
        kind="analysis",
        status="queued",
        progress={"step": 1},
        result={"score": 88},
        pdf_base64=None,
        decomposition={"parts": ["a", "b"]},
        error=None,
        request={"contract_id": "123"},
        created_at=_timestamp(),
        updated_at=_timestamp(),
    )

    store.upsert_job(job)

    loaded = store.get_job("job-1")
    assert loaded is not None
    assert loaded.job_id == job.job_id
    assert loaded.progress == {"step": 1}
    assert loaded.result == {"score": 88}
    assert loaded.request == {"contract_id": "123"}


def test_job_store_update_returns_updated_job(tmp_path: Path) -> None:
    store = JobStore(str(tmp_path / "jobs.sqlite3"))
    base = StoredJob(
        job_id="job-2",
        kind="analysis",
        status="queued",
        progress=None,
        result=None,
        pdf_base64=None,
        decomposition=None,
        error=None,
        request=None,
        created_at=_timestamp(),
        updated_at=_timestamp(),
    )

    store.upsert_job(base)
    updated = store.update_job("job-2", status="running", progress={"pct": 25})

    assert updated is not None
    assert updated.status == "running"
    assert updated.progress == {"pct": 25}
    assert store.get_job("job-2").status == "running"