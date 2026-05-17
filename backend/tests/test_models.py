from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.models import InputFile, RenderRequest


def test_input_file_rejects_path_traversal() -> None:
    with pytest.raises(ValueError, match="path separators"):
        InputFile(file_name="../secret.png", base64_content="aGVsbG8=")


def test_input_file_rejects_base64_alias() -> None:
    with pytest.raises(ValidationError, match="base64_content"):
        InputFile(file_name="logo.png", base64="aGVsbG8=")


def test_render_request_rejects_duplicate_input_filenames() -> None:
    with pytest.raises(ValueError, match="duplicate input file name"):
        RenderRequest(
            html="<section class='slide'>Hello</section>",
            input_files=[
                InputFile(file_name="logo.png", base64_content="aGVsbG8="),
                InputFile(file_name="logo.png", base64_content="aGVsbG8="),
            ],
        )


def test_render_request_rejects_client_rendering_version() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        RenderRequest(
            html="<section class='slide'>Hello</section>",
            rendering_version="v2",
        )
