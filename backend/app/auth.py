from __future__ import annotations

import re
import secrets
from dataclasses import dataclass

from fastapi import HTTPException, Request

from .config import SETTINGS

_HEADER_NAME_RE = re.compile(r"^[A-Za-z0-9-]+$")
_API_KEY_HEADER_NAME = "X-API-Key"


@dataclass(frozen=True)
class ApiKeyAuthConfig:
    enabled: bool
    keys: tuple[str, ...]


AUTH_CONFIG = ApiKeyAuthConfig(
    enabled=SETTINGS.api_key_auth_enabled,
    keys=SETTINGS.api_keys,
)

_DISALLOWED_DEFAULT_KEYS = {
    "change-me-with-a-long-random-key",
    "replace-with-a-long-random-api-key",
    "changeme",
    "default",
}


def validate_auth_configuration() -> None:
    """Validate API key authentication configuration."""
    if not AUTH_CONFIG.enabled:
        return
    if not _HEADER_NAME_RE.fullmatch(_API_KEY_HEADER_NAME):
        raise RuntimeError("internal error: invalid API key header name")
    if not AUTH_CONFIG.keys:
        raise RuntimeError("API key authentication is enabled but API_KEYS is empty")
    if len(set(AUTH_CONFIG.keys)) != len(AUTH_CONFIG.keys):
        raise RuntimeError("API_KEYS contains duplicate values")
    normalized_keys = tuple(key.strip() for key in AUTH_CONFIG.keys)
    if any(not key for key in normalized_keys):
        raise RuntimeError("API_KEYS contains empty values")
    short_keys = [key for key in normalized_keys if len(key) < 16]
    if short_keys:
        raise RuntimeError("all API keys must be at least 16 characters")
    lower_keys = {key.lower() for key in normalized_keys}
    if lower_keys.intersection(_DISALLOWED_DEFAULT_KEYS):
        raise RuntimeError("API_KEYS must not use placeholder/default values")


def is_request_api_key_authorized(request: Request) -> bool:
    """Check if request contains valid API key."""
    if not AUTH_CONFIG.enabled:
        return True

    presented_key = request.headers.get(_API_KEY_HEADER_NAME)
    if presented_key:
        presented_key = presented_key.strip()

    if not presented_key:
        authorization = request.headers.get("Authorization", "")
        if authorization.lower().startswith("bearer "):
            presented_key = authorization[7:].strip()

    if not presented_key:
        return False

    for expected_key in AUTH_CONFIG.keys:
        normalized_expected_key = expected_key.strip()
        if secrets.compare_digest(presented_key, normalized_expected_key):
            return True
    return False


async def require_api_key(request: Request) -> None:
    """Require valid API key for request, raising HTTPException if invalid."""
    if is_request_api_key_authorized(request):
        return

    raise HTTPException(
        status_code=401,
        detail="invalid or missing API key",
        headers={"WWW-Authenticate": "ApiKey"},
    )
