#!/usr/bin/env python3
"""Run the benchmark without installing the local package."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from rag_benchmark.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())

