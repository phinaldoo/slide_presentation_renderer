from __future__ import annotations

from fastapi import Request
import pytest

from .conftest import reload_renderer_module


def _make_request(headers: list[tuple[bytes, bytes]]) -> Request:
    return Request({"type": "http", "headers": headers})


def test_validate_auth_configuration_rejects_placeholder_key(monkeypatch) -> None:
    monkeypatch.setenv("API_KEY_AUTH_ENABLED", "true")
    monkeypatch.setenv("API_KEYS", "change-me-with-a-long-random-key")

    auth = reload_renderer_module("backend.app.auth")

    with pytest.raises(RuntimeError, match="placeholder/default"):
        auth.validate_auth_configuration()


def test_api_key_auth_is_case_sensitive(monkeypatch) -> None:
    monkeypatch.setenv("API_KEY_AUTH_ENABLED", "true")
    monkeypatch.setenv("API_KEYS", "CaseSensitiveSecret123")

    auth = reload_renderer_module("backend.app.auth")

    authorized = _make_request([(b"x-api-key", b"CaseSensitiveSecret123")])
    unauthorized = _make_request([(b"x-api-key", b"casesensitivesecret123")])

    assert auth.is_request_api_key_authorized(authorized) is True
    assert auth.is_request_api_key_authorized(unauthorized) is False
