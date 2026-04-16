from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from render import html_file_to_pptx


async def _run(args: argparse.Namespace) -> None:
    """Run the HTML to PPTX conversion."""
    output_path = await html_file_to_pptx(
        args.html,
        output_dir=args.output_dir,
        selector=args.selector,
    )
    print(f"PPTX gespeichert unter: {output_path}")


def main() -> None:
    """Main entry point for CLI HTML to PPTX conversion."""
    parser = argparse.ArgumentParser(description="Render HTML slides to PPTX")
    parser.add_argument(
        "html",
        type=Path,
        nargs="?",
        default=Path("presentation.html"),
        help="Pfad zur HTML-Datei (Standard: presentation.html)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Optionales Zielverzeichnis für die PPTX-Datei",
    )
    parser.add_argument(
        "--selector",
        type=str,
        default=None,
        help="CSS-Selektor für einzelne Slides (Standard: .slide)",
    )
    args = parser.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()

