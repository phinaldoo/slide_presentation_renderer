from __future__ import annotations

import asyncio
import logging
import os

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response

from .auth import require_api_key, validate_auth_configuration
from .config import SETTINGS
from .models import RenderRequest
from .render_service import (
    RenderExecutionError,
    RenderValidationError,
    render_presentation,
)

logger = logging.getLogger("slide_renderer")


def _docs_enabled() -> bool:
    return os.getenv("ENABLE_DOCS", "false").strip().lower() in {"1", "true", "yes"}


def _allowed_hosts() -> list[str]:
    raw = os.getenv("ALLOWED_HOSTS", "*")
    values = [value.strip() for value in raw.split(",") if value.strip()]
    return values or ["*"]


app = FastAPI(
    title="Slide Presentation Renderer API",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled() else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_enabled() else None,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts())
_render_slots = asyncio.Semaphore(SETTINGS.max_concurrent_renders)


@app.on_event("startup")
async def startup_checks() -> None:
    validate_auth_configuration()


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/internal/auth/apikey", include_in_schema=False)
async def internal_api_key_auth(request: Request) -> Response:
    await require_api_key(request)
    return Response(status_code=204)


@app.post("/api/render")
@app.post("/api/v1/render")
async def render_endpoint(payload: RenderRequest, _: None = Depends(require_api_key)) -> Response:
    acquired_slot = False
    try:
        await asyncio.wait_for(_render_slots.acquire(), timeout=0.05)
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
        "X-Slide-Count": str(result.slide_count),
    }
    return Response(content=result.content, media_type=result.media_type, headers=headers)
