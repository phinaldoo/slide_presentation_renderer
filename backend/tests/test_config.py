from __future__ import annotations

import pytest

from .conftest import reload_renderer_module


def test_validate_runtime_configuration_rejects_invalid_asset_limits(monkeypatch) -> None:
    monkeypatch.setenv("MAX_ASSET_BYTES", "2048")
    monkeypatch.setenv("MAX_TOTAL_ASSET_BYTES", "1024")

    config = reload_renderer_module("backend.app.config")

    with pytest.raises(RuntimeError, match="MAX_TOTAL_ASSET_BYTES"):
        config.validate_runtime_configuration()


def test_validate_runtime_configuration_rejects_insecure_production_hosts(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_HOSTS", "*")
    monkeypatch.setenv("API_KEY_AUTH_ENABLED", "true")
    monkeypatch.setenv("API_KEYS", "ProductionSecret1234")

    config = reload_renderer_module("backend.app.config")

    with pytest.raises(RuntimeError, match="ALLOWED_HOSTS"):
        config.validate_runtime_configuration()


def test_validate_runtime_configuration_rejects_small_request_body_limit(monkeypatch) -> None:
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", "1000")
    monkeypatch.setenv("MAX_HTML_CHARS", "2000")

    config = reload_renderer_module("backend.app.config")

    with pytest.raises(RuntimeError, match="MAX_REQUEST_BODY_BYTES"):
        config.validate_runtime_configuration()


def test_validate_runtime_configuration_allows_explicit_override(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_HOSTS", "*")
    monkeypatch.setenv("API_KEY_AUTH_ENABLED", "true")
    monkeypatch.setenv("API_KEYS", "ProductionSecret1234")
    monkeypatch.setenv("ALLOW_INSECURE_PRODUCTION_CONFIGURATION", "true")

    config = reload_renderer_module("backend.app.config")

    config.validate_runtime_configuration()
