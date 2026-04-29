from __future__ import annotations

import pytest

from backend.app.models import InputFile, RenderRequest, RenderingVersion


def test_input_file_rejects_path_traversal() -> None:
    with pytest.raises(ValueError, match="path separators"):
        InputFile(file_name="../secret.png", base64_content="aGVsbG8=")


def test_render_request_rejects_duplicate_input_filenames() -> None:
    with pytest.raises(ValueError, match="duplicate input file name"):
        RenderRequest(
            html="<section class='slide'>Hello</section>",
            rendering_version=RenderingVersion.v1,
            input_files=[
                InputFile(file_name="logo.png", base64_content="aGVsbG8="),
                InputFile(file_name="logo.png", base64_content="aGVsbG8="),
            ],
        )
