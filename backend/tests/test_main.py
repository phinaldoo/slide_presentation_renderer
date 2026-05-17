from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from .conftest import reload_renderer_module


def _load_main(monkeypatch, *, beta: bool = False):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("DEVELOPMENT_MODE", "false")
    monkeypatch.setenv("ENABLE_DOCS", "false")
    monkeypatch.setenv("ALLOWED_HOSTS", "testserver")
    monkeypatch.setenv("API_KEY_AUTH_ENABLED", "true")
    monkeypatch.setenv("API_KEYS", "TestRendererSecret123")
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", "5000")
    monkeypatch.setenv("MAX_HTML_CHARS", "4000")
    monkeypatch.setenv("MAX_ASSET_BYTES", "2000")
    monkeypatch.setenv("MAX_TOTAL_ASSET_BYTES", "3000")
    monkeypatch.setenv("BETA", "true" if beta else "false")
    return reload_renderer_module("backend.app.main")


def test_readyz_returns_ok(monkeypatch) -> None:
    main = _load_main(monkeypatch)
    monkeypatch.setattr(main, "validate_render_environment", lambda: None)

    with TestClient(main.app) as client:
        response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_render_endpoint_requires_api_key(monkeypatch) -> None:
    main = _load_main(monkeypatch)
    monkeypatch.setattr(main, "validate_render_environment", lambda: None)

    with TestClient(main.app) as client:
        response = client.post("/api/render", json={"html": "<section class='slide'>Hello</section>"})

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or missing API key"


def test_render_endpoint_returns_archive_headers(monkeypatch) -> None:
    main = _load_main(monkeypatch)
    monkeypatch.setattr(main, "validate_render_environment", lambda: None)

    async def fake_render_presentation(payload):
        assert not hasattr(payload, "rendering_version")
        return SimpleNamespace(
            file_name="presentation_v1_20260428T120000Z.zip",
            rendering_version=SimpleNamespace(value="v1"),
            content=b"zip-bytes",
            media_type="application/zip",
            slide_count=3,
        )

    monkeypatch.setattr(main, "render_presentation", fake_render_presentation)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/render",
            headers={"X-API-Key": "TestRendererSecret123"},
            json={"html": "<section class='slide'>Hello</section>"},
        )

    assert response.status_code == 200
    assert response.content == b"zip-bytes"
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["x-rendering-version"] == "v1"
    assert response.headers["x-slide-count"] == "3"
    assert "presentation_v1_20260428T120000Z.zip" in response.headers["content-disposition"]


def test_render_endpoint_rejects_client_rendering_version(monkeypatch) -> None:
    main = _load_main(monkeypatch)
    monkeypatch.setattr(main, "validate_render_environment", lambda: None)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/render",
            headers={"X-API-Key": "TestRendererSecret123"},
            json={"html": "<section class='slide'>Hello</section>", "rendering_version": "v2"},
        )

    assert response.status_code == 422


def test_render_endpoint_rejects_oversized_body(monkeypatch) -> None:
    main = _load_main(monkeypatch)
    monkeypatch.setattr(main, "validate_render_environment", lambda: None)

    oversized_body = b"{" + (b"a" * 6000) + b"}"

    with TestClient(main.app) as client:
        response = client.post(
            "/api/render",
            headers={
                "X-API-Key": "TestRendererSecret123",
                "Content-Type": "application/json",
            },
            content=oversized_body,
        )

    assert response.status_code == 413
    assert "request body exceeds max size" in response.json()["detail"]
