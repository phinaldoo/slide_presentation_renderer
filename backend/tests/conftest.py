from __future__ import annotations

import importlib
import sys


RENDERER_MODULES = [
    "backend.app.config",
    "backend.app.auth",
    "backend.app.render_service",
    "backend.app.main",
]


def reload_renderer_module(module_name: str):
    for loaded_name in RENDERER_MODULES:
        sys.modules.pop(loaded_name, None)
    return importlib.import_module(module_name)
