from __future__ import annotations

import asyncio
import base64
import binascii
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .config import SETTINGS
from .local_server import LocalStaticServer
from .models import RenderRequest, RenderingVersion

PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_V2_SCRIPT_PATH = _PROJECT_ROOT / "v2" / "index.js"
_V2_WORKDIR = _PROJECT_ROOT / "v2"
_SUBPROCESS_ENV_KEYS = {
    "PATH",
    "HOME",
    "XDG_CACHE_HOME",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONUNBUFFERED",
}


class RenderValidationError(ValueError):
    """Raised when request payload is invalid for rendering."""


class RenderExecutionError(RuntimeError):
    """Raised when renderer execution fails."""


@dataclass(frozen=True)
class RenderResult:
    file_name: str
    rendering_version: RenderingVersion
    content: bytes


async def render_presentation(request: RenderRequest) -> RenderResult:
    if len(request.html) > SETTINGS.max_html_chars:
        raise RenderValidationError(
            f"html is too large (>{SETTINGS.max_html_chars} characters)"
        )
    if len(request.input_files) > SETTINGS.max_input_files:
        raise RenderValidationError(
            f"too many input_files (max {SETTINGS.max_input_files})"
        )

    with tempfile.TemporaryDirectory(prefix="presentation_") as tmp_dir:
        presentation_root = Path(tmp_dir)
        html_path = presentation_root / "index.html"
        assets_dir = presentation_root / "assets"
        output_dir = presentation_root / "output"

        assets_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        html_path.write_text(request.html, encoding="utf-8")

        _save_assets(request, assets_dir)

        with LocalStaticServer(presentation_root) as server:
            input_url = f"{server.base_url}/index.html"
            allowed_origin = server.base_url
            if request.rendering_version == RenderingVersion.v1:
                output_path = await _render_v1(input_url, output_dir, allowed_origin)
            else:
                output_path = await _render_v2(input_url, output_dir, allowed_origin)

        if not output_path.exists():
            raise RenderExecutionError("renderer finished but no pptx output was produced")

        pptx_content = output_path.read_bytes()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    file_name = f"presentation_{request.rendering_version.value}_{timestamp}.pptx"
    return RenderResult(
        file_name=file_name,
        rendering_version=request.rendering_version,
        content=pptx_content,
    )


def _save_assets(request: RenderRequest, assets_dir: Path) -> None:
    total_bytes = 0

    for input_file in request.input_files:
        try:
            decoded_bytes = _decode_base64(input_file.base64_content)
        except binascii.Error as exc:
            raise RenderValidationError(
                f"input file '{input_file.file_name}' has invalid base64 content"
            ) from exc

        file_size = len(decoded_bytes)
        if file_size > SETTINGS.max_asset_bytes:
            raise RenderValidationError(
                f"input file '{input_file.file_name}' exceeds max size of "
                f"{SETTINGS.max_asset_bytes} bytes"
            )

        total_bytes += file_size
        if total_bytes > SETTINGS.max_total_asset_bytes:
            raise RenderValidationError(
                f"input_files exceed max combined size of "
                f"{SETTINGS.max_total_asset_bytes} bytes"
            )

        (assets_dir / input_file.file_name).write_bytes(decoded_bytes)


def _decode_base64(content: str) -> bytes:
    payload = content.strip()
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]
    return base64.b64decode(payload, validate=True)


async def _render_v1(input_url: str, output_dir: Path, allowed_origin: str) -> Path:
    from v1.render import html_url_to_pptx

    return await html_url_to_pptx(
        input_url,
        output_dir=output_dir,
        allowed_origin=allowed_origin,
    )


async def _render_v2(input_url: str, output_dir: Path, allowed_origin: str) -> Path:
    if not _V2_SCRIPT_PATH.exists():
        raise RenderExecutionError(f"v2 renderer script not found: {_V2_SCRIPT_PATH}")

    output_path = output_dir / f"presentation_{uuid.uuid4()}.pptx"
    env = {
        key: value
        for key, value in os.environ.items()
        if key in _SUBPROCESS_ENV_KEYS and value
    }
    env["ALLOWED_ORIGIN"] = allowed_origin

    process = await asyncio.create_subprocess_exec(
        "node",
        str(_V2_SCRIPT_PATH),
        input_url,
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(_V2_WORKDIR),
        env=env,
    )
    try:
        stdout_bytes, stderr_bytes = await process.communicate()
    except asyncio.CancelledError:
        process.kill()
        await process.wait()
        raise

    if process.returncode != 0:
        stdout_text = stdout_bytes.decode("utf-8", errors="replace").strip()
        stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()
        message = stderr_text or stdout_text or "unknown renderer error"
        raise RenderExecutionError(f"v2 renderer failed: {message}")

    return output_path
