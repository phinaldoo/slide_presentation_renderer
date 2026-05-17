from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Final

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .auth import require_api_key, validate_auth_configuration
from .config import SETTINGS, validate_runtime_configuration
from .models import RenderRequest
from .render_service import (
    RenderExecutionError,
    RenderValidationError,
    render_presentation,
    validate_render_environment,
)
from .version import APP_VERSION, APP_VERSION_TAG, get_version_payload

logger = logging.getLogger("slide_renderer")
_API_PATH_PREFIX: Final[str] = "/api/"


class _RequestBodyTooLargeError(RuntimeError):
    """Raised when a request body exceeds the configured limit."""


class RequestSizeLimitMiddleware:
    """Reject oversized API request bodies before they reach route handlers."""

    def __init__(self, app: ASGIApp, *, max_body_bytes: int, path_prefix: str = _API_PATH_PREFIX):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.path_prefix = path_prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._should_limit(scope):
            await self.app(scope, receive, send)
            return

        content_length = self._content_length(scope)
        if content_length is not None and content_length > self.max_body_bytes:
            await self._send_too_large(send)
            return

        bytes_received = 0

        async def limited_receive() -> Message:
            nonlocal bytes_received
            message = await receive()
            if message["type"] != "http.request":
                return message

            body = message.get("body", b"")
            bytes_received += len(body)
            if bytes_received > self.max_body_bytes:
                raise _RequestBodyTooLargeError
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _RequestBodyTooLargeError:
            await self._send_too_large(send)

    def _should_limit(self, scope: Scope) -> bool:
        return (
            scope["type"] == "http"
            and scope.get("method", "").upper() == "POST"
            and str(scope.get("path") or "").startswith(self.path_prefix)
        )

    @staticmethod
    def _content_length(scope: Scope) -> int | None:
        for header_name, header_value in scope.get("headers", []):
            if header_name.lower() != b"content-length":
                continue
            try:
                return int(header_value.decode("ascii"))
            except (UnicodeDecodeError, ValueError):
                return None
        return None

    async def _send_too_large(self, send: Send) -> None:
        body = json.dumps(
            {"detail": f"request body exceeds max size of {self.max_body_bytes} bytes"}
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body, "more_body": False})


def _docs_enabled() -> bool:
    """Check if API documentation is enabled."""
    return SETTINGS.docs_enabled


def _allowed_hosts() -> list[str]:
    """Get list of allowed hosts from environment."""
    values = [value.strip() for value in SETTINGS.allowed_hosts if value.strip()]
    return values or ["*"]


async def _run_startup_checks() -> None:
    """Run startup validation checks."""
    validate_runtime_configuration()
    validate_auth_configuration()
    validate_render_environment()
    logger.info(
        "slide renderer startup complete environment=%s docs_enabled=%s auth_enabled=%s "
        "max_concurrent_renders=%d max_request_body_bytes=%d",
        SETTINGS.environment_name,
        SETTINGS.docs_enabled,
        SETTINGS.api_key_auth_enabled,
        SETTINGS.max_concurrent_renders,
        SETTINGS.max_request_body_bytes,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _run_startup_checks()
    yield


app = FastAPI(
    title="Slide Presentation Renderer API",
    version=APP_VERSION,
    docs_url="/docs" if _docs_enabled() else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_enabled() else None,
    lifespan=lifespan,
)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_body_bytes=SETTINGS.max_request_body_bytes,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts())
_render_slots = asyncio.Semaphore(SETTINGS.max_concurrent_renders)


@app.get("/livez")
async def livez() -> JSONResponse:
    """Liveness check endpoint."""
    return JSONResponse({"status": "ok"})


@app.get("/")
async def root() -> JSONResponse:
    """Service information endpoint."""
    return JSONResponse(
        {
            "message": "Slide Presentation Renderer API",
            "version": APP_VERSION_TAG,
            "render_endpoint": "/api/render",
            "version_endpoint": "/version",
        }
    )


@app.get("/version")
async def version() -> JSONResponse:
    """Application and renderer contract version endpoint."""
    return JSONResponse(get_version_payload())


@app.get("/readyz")
async def readyz() -> JSONResponse:
    """Readiness check endpoint."""
    try:
        validate_runtime_configuration()
        validate_auth_configuration()
        validate_render_environment()
    except RuntimeError as exc:
        return JSONResponse({"status": "error", "detail": str(exc)}, status_code=503)
    return JSONResponse({"status": "ok"})


@app.get("/healthz")
async def healthz() -> JSONResponse:
    """Backward-compatible health check endpoint."""
    return await readyz()


@app.get("/internal/auth/apikey", include_in_schema=False)
async def internal_api_key_auth(request: Request) -> Response:
    """Internal endpoint to validate API key authentication."""
    await require_api_key(request)
    return Response(status_code=204)


@app.post("/api/render")
async def render_endpoint(payload: RenderRequest, _: None = Depends(require_api_key)) -> Response:
    """Render presentation HTML to PPTX with slide images."""
    acquired_slot = False
    try:
        await asyncio.wait_for(
            _render_slots.acquire(),
            timeout=SETTINGS.render_queue_timeout_ms / 1000,
        )
        acquired_slot = True
        result = await asyncio.wait_for(
            render_presentation(payload),
            timeout=SETTINGS.render_timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        if not acquired_slot:
            raise HTTPException(
                status_code=429,
                detail="renderer is busy, please retry shortly",
                headers={"Retry-After": "1"},
            ) from exc
        raise HTTPException(status_code=504, detail="render timeout exceeded") from exc
    except RenderValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RenderExecutionError as exc:
        logger.exception("render execution failed")
        raise HTTPException(status_code=500, detail="rendering failed") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("unexpected render failure")
        raise HTTPException(status_code=500, detail="internal server error") from exc
    finally:
        if acquired_slot:
            _render_slots.release()

    headers = {
        "Content-Disposition": f'attachment; filename="{result.file_name}"',
        "X-Rendering-Version": result.rendering_version.value,
        "X-Renderer-Version": APP_VERSION,
        "X-Renderer-Version-Tag": APP_VERSION_TAG,
        "X-Slide-Count": str(result.slide_count),
    }
    return Response(content=result.content, media_type=result.media_type, headers=headers)
