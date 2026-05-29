from __future__ import annotations

from app.proxy import _filtered_headers


def test_filtered_headers_removes_hop_by_hop_and_host_headers() -> None:
    headers = [
        ("host", "example.com"),
        ("content-length", "123"),
        ("connection", "keep-alive"),
        ("x-request-id", "abc-123"),
        ("content-type", "application/json"),
    ]

    filtered = _filtered_headers(headers)

    assert filtered == {
        "x-request-id": "abc-123",
        "content-type": "application/json",
    }
