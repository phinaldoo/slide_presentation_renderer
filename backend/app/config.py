from __future__ import annotations

import os
from dataclasses import dataclass


def _get_int(name: str, default: int, *, min_value: int) -> int:
    """Get integer from environment variable with default and minimum value."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(value, min_value)


def _get_bool(name: str, default: bool) -> bool:
    """Get boolean from environment variable with default."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_csv(name: str) -> tuple[str, ...]:
    """Get comma-separated values from environment variable as tuple."""
    raw = os.getenv(name, "")
    values = [value.strip() for value in raw.split(",") if value.strip()]
    return tuple(values)


@dataclass(frozen=True)
class Settings:
    render_timeout_seconds: int
    max_concurrent_renders: int
    api_key_auth_enabled: bool
    api_keys: tuple[str, ...]
    max_html_chars: int
    max_input_files: int
    max_asset_bytes: int
    max_total_asset_bytes: int


SETTINGS = Settings(
    render_timeout_seconds=_get_int("RENDER_TIMEOUT_SECONDS", 180, min_value=5),
    max_concurrent_renders=_get_int("MAX_CONCURRENT_RENDERS", 2, min_value=1),
    api_key_auth_enabled=_get_bool("API_KEY_AUTH_ENABLED", True),
    api_keys=_get_csv("API_KEYS"),
    max_html_chars=_get_int("MAX_HTML_CHARS", 2_000_000, min_value=1_000),
    max_input_files=_get_int("MAX_INPUT_FILES", 32, min_value=1),
    max_asset_bytes=_get_int("MAX_ASSET_BYTES", 25_000_000, min_value=1_024),
    max_total_asset_bytes=_get_int("MAX_TOTAL_ASSET_BYTES", 120_000_000, min_value=1_024),
)
