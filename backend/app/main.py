from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .analysis_jobs import create_analysis_job, get_analysis_job, serialize_job as serialize_analysis_job
from .proxy import proxy_to_frontend
from .rfp_jobs import create_rfp_job, get_rfp_job, serialize_job
from .settings import settings


app = FastAPI(title="ProcureNet Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168(\.\d+){0,2}|10(\.\d+){3}|192\.168\.56\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


class RfpBackgroundRequest(BaseModel):
    organization_name: str
    project_title: str
    category: str
    sections: dict[str, str]
    detailed_project_description: str
    additional_details: str | None = None
    selected_template: str | None = None
    selectedSubsystems: list[str] | None = None
    qaReview: dict | None = None
    qaRevisionNotes: str | None = None
    skipDecomposition: bool | None = None
    fastMode: bool | None = True
    precomputedDecomposition: dict | None = None


class AnalysisBackgroundRequest(BaseModel):
    contract_id: str
    contract: dict
    vendors: list[dict]
    mandatoryCriteria: dict | None = None


@app.post("/api/rfp/generate/background")
async def start_rfp_background_job(body: RfpBackgroundRequest):
    job = create_rfp_job(body.model_dump(exclude_none=True), fast_mode=bool(body.fastMode))
    return {"job_id": job.job_id}


@app.get("/api/rfp/generate/jobs/{job_id}")
async def get_rfp_background_job(job_id: str):
    job = get_rfp_job(job_id)
    if not job:
        return {"error": "Job not found"}
    return {"job": serialize_job(job)}


@app.post("/api/ai/analyze-proposal/background")
async def start_analysis_background_job(body: AnalysisBackgroundRequest, request: Request):
    job = create_analysis_job(body.model_dump(exclude_none=True), str(request.base_url).rstrip("/"))
    return {"job_id": job.id, "status": "queued"}


@app.get("/api/ai/analysis-jobs/{job_id}")
async def get_analysis_background_job(job_id: str):
    job = get_analysis_job(job_id)
    if not job:
        return {"error": "Analysis job not found"}
    return {"job": serialize_analysis_job(job)}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_proxy(path: str, request: Request):
    return await proxy_to_frontend(request, settings.frontend_base_url, f"/api/{path}")
