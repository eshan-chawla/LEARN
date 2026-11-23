#!/usr/bin/env python3
"""Regenerate every paper table and figure from the committed results.

    python analysis/make_all.py [--results results] [--traj-run <runId>]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import make_plots  # noqa: E402
import make_tables  # noqa: E402
from common import RESULTS_DIR  # noqa: E402


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--results", default=str(RESULTS_DIR))
    parser.add_argument("--traj-run", default=None)
    args = parser.parse_args(argv)

    shared = ["--results", args.results] + (["--traj-run", args.traj_run] if args.traj_run else [])
    return make_tables.main(shared) or make_plots.main(shared)


if __name__ == "__main__":
    raise SystemExit(main())
