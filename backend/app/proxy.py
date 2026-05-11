from __future__ import annotations

from typing import Iterable

import httpx
from fastapi import Request, Response
from fastapi.responses import JSONResponse


def _filtered_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    hop_by_hop = {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
    return {
        key: value
        for key, value in headers
        if key.lower() not in hop_by_hop
    }


async def proxy_to_frontend(request: Request, upstream_base_url: str, path: str) -> Response:
    upstream_url = f"{upstream_base_url.rstrip('/')}{path}"
    body = await request.body()

    headers = _filtered_headers(request.headers.items())
    headers.pop("origin", None)

    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            upstream = await client.request(
                method=request.method,
                url=upstream_url,
                params=request.query_params,
                content=body,
                headers=headers,
            )
    except httpx.ConnectError:
        return JSONResponse(
            {
                "error": "Frontend upstream unavailable",
                "message": f"Could not connect to frontend at {upstream_base_url}. Start the frontend server and retry.",
            },
            status_code=502,
        )
    except httpx.RequestError as exc:
        return JSONResponse(
            {
                "error": "Frontend upstream request failed",
                "message": str(exc),
            },
            status_code=502,
        )

    response_headers = _filtered_headers(upstream.headers.items())
    return Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)
