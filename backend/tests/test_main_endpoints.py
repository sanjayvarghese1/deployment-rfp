from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.responses import Response

import app.main as main


client = TestClient(main.app)


def test_generate_background_endpoint_invokes_rfp_job(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_create_rfp_job(payload, fast_mode=True):
        captured["payload"] = payload
        captured["fast_mode"] = fast_mode
        return SimpleNamespace(job_id="rfp-job-1")

    monkeypatch.setattr(main, "create_rfp_job", fake_create_rfp_job)

    response = client.post(
        "/api/rfp/generate/background",
        json={
            "organization_name": "Acme Corp",
            "project_title": "ProcureNet",
            "category": "software",
            "sections": {"executive_summary": "Summary"},
            "detailed_project_description": "Build a procurement workflow",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"job_id": "rfp-job-1"}
    assert captured["fast_mode"] is True
    assert captured["payload"]["project_title"] == "ProcureNet"


def test_analysis_background_endpoint_invokes_analysis_job(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_create_analysis_job(payload, origin):
        captured["payload"] = payload
        captured["origin"] = origin
        return SimpleNamespace(id="analysis-job-1")

    monkeypatch.setattr(main, "create_analysis_job", fake_create_analysis_job)

    response = client.post(
        "/api/ai/analyze-proposal/background",
        json={
            "contract_id": "contract-1",
            "contract": {"title": "Contract", "description": "Desc"},
            "vendors": [{"name": "Vendor A"}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"job_id": "analysis-job-1", "status": "queued"}
    assert captured["payload"]["contract_id"] == "contract-1"
    assert str(captured["origin"]).startswith("http://testserver")


def test_job_endpoints_return_not_found_for_unknown_jobs() -> None:
    assert client.get("/api/rfp/generate/jobs/missing").json() == {"error": "Job not found"}
    assert client.get("/api/ai/analysis-jobs/missing").json() == {"error": "Analysis job not found"}


def test_catch_all_api_proxy_forwards_to_proxy_layer(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_proxy_to_frontend(request, upstream_base_url, path):
        captured["method"] = request.method
        captured["base_url"] = upstream_base_url
        captured["path"] = path
        return Response(status_code=204)

    monkeypatch.setattr(main, "proxy_to_frontend", fake_proxy_to_frontend)

    response = client.post("/api/rfp/custom-route?x=1", json={"hello": "world"})

    assert response.status_code == 204
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/rfp/custom-route"
