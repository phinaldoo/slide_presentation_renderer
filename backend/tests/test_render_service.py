from __future__ import annotations

import pytest

from .conftest import reload_renderer_module


def test_validate_slide_count_rejects_too_many_slides(monkeypatch) -> None:
    monkeypatch.setenv("MAX_SLIDES", "2")

    render_service = reload_renderer_module("backend.app.render_service")

    with pytest.raises(render_service.RenderValidationError, match="too many slides"):
        render_service._validate_slide_count(3)


def test_render_output_budget_rejects_oversized_output(monkeypatch) -> None:
    monkeypatch.setenv("MAX_RENDER_OUTPUT_BYTES", "2048")

    render_service = reload_renderer_module("backend.app.render_service")

    with pytest.raises(render_service.RenderValidationError, match="render output exceeds"):
        render_service._ensure_render_output_budget(1024, 1025, "slide_001.png")


def test_render_output_budget_returns_new_total(monkeypatch) -> None:
    monkeypatch.setenv("MAX_RENDER_OUTPUT_BYTES", "2048")

    render_service = reload_renderer_module("backend.app.render_service")

    assert render_service._ensure_render_output_budget(1024, 1024, "slide_001.png") == 2048
