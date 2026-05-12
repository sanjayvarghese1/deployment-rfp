from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any


@dataclass(slots=True)
class StoredJob:
    job_id: str
    kind: str
    status: str
    progress: dict[str, Any] | None
    result: dict[str, Any] | None
    pdf_base64: str | None
    decomposition: dict[str, Any] | None
    error: str | None
    request: dict[str, Any] | None
    created_at: str
    updated_at: str


class JobStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS background_jobs (
                    job_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress TEXT,
                    result TEXT,
                    pdf_base64 TEXT,
                    decomposition TEXT,
                    error TEXT,
                    request TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_background_jobs_kind ON background_jobs(kind)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status)")
            connection.commit()

    @staticmethod
    def _dump(value: dict[str, Any] | None) -> str | None:
        if value is None:
            return None
        return json.dumps(value, separators=(",", ":"))

    @staticmethod
    def _load(value: str | None) -> dict[str, Any] | None:
        if not value:
            return None
        return json.loads(value)

    def upsert_job(self, job: StoredJob) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO background_jobs (
                    job_id, kind, status, progress, result, pdf_base64, decomposition, error, request, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    kind=excluded.kind,
                    status=excluded.status,
                    progress=excluded.progress,
                    result=excluded.result,
                    pdf_base64=excluded.pdf_base64,
                    decomposition=excluded.decomposition,
                    error=excluded.error,
                    request=excluded.request,
                    updated_at=excluded.updated_at
                """,
                (
                    job.job_id,
                    job.kind,
                    job.status,
                    self._dump(job.progress),
                    self._dump(job.result),
                    job.pdf_base64,
                    self._dump(job.decomposition),
                    job.error,
                    self._dump(job.request),
                    job.created_at,
                    job.updated_at,
                ),
            )
            connection.commit()

    def update_job(self, job_id: str, **patch: Any) -> StoredJob | None:
        current = self.get_job(job_id)
        if not current:
            return None

        updated = StoredJob(
            job_id=current.job_id,
            kind=str(patch.get("kind", current.kind)),
            status=str(patch.get("status", current.status)),
            progress=patch.get("progress", current.progress),
            result=patch.get("result", current.result),
            pdf_base64=patch.get("pdf_base64", current.pdf_base64),
            decomposition=patch.get("decomposition", current.decomposition),
            error=patch.get("error", current.error),
            request=patch.get("request", current.request),
            created_at=current.created_at,
            updated_at=str(patch.get("updated_at", current.updated_at)),
        )
        self.upsert_job(updated)
        return updated

    def get_job(self, job_id: str) -> StoredJob | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT job_id, kind, status, progress, result, pdf_base64, decomposition, error, request, created_at, updated_at
                FROM background_jobs
                WHERE job_id = ?
                """,
                (job_id,),
            ).fetchone()

        if row is None:
            return None

        return StoredJob(
            job_id=row["job_id"],
            kind=row["kind"],
            status=row["status"],
            progress=self._load(row["progress"]),
            result=self._load(row["result"]),
            pdf_base64=row["pdf_base64"],
            decomposition=self._load(row["decomposition"]),
            error=row["error"],
            request=self._load(row["request"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

