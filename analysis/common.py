"""Shared loading and statistics for the paper's tables and figures (J4).

Inputs are the committed results files written by the TypeScript runners:

  results/single_turn/<runId>.jsonl          one row per benchmark item (run-single-turn.ts)
  results/trajectories/<runId>.jsonl         one row per tutor turn     (run-trajectories.ts)
  results/trajectories/<runId>.summary.json  per-condition metrics + 95% bootstrap CIs

Trajectory headline numbers are read from the summary files, which the TypeScript metrics
(learn/eval/trajectory-metrics.ts) computed, so the paper cannot disagree with the tested
metric code. Single-turn means and CIs are computed here from the per-item rows.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

REPO_DIR = Path(__file__).resolve().parents[1]
RESULTS_DIR = REPO_DIR / "results"
PAPER_DIR = REPO_DIR / "paper"

BOOTSTRAP_ITERS = 2000
ALPHA = 0.05
SEED = 1

ABLATION_ORDER = ["A0", "A1", "A2", "A3"]
MEMORY_ORDER = ["M0", "M1", "M1b", "M2"]


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


# --- statistics -------------------------------------------------------------------------


@dataclass(frozen=True)
class CI:
    mean: float
    lower: float
    upper: float
    n: int

    @property
    def half_width(self) -> float:
        return (self.upper - self.lower) / 2

    @staticmethod
    def from_summary(value: Optional[Dict[str, Any]]) -> Optional["CI"]:
        """Reads a ConfidenceInterval object written by learn/eval/stats.ts."""
        if not value:
            return None
        return CI(float(value["estimate"]), float(value["lower"]), float(value["upper"]), int(value["n"]))


def finite(values: Iterable[Any]) -> List[float]:
    """Numbers only; booleans become 0/1; None/NaN/inf are dropped (metric undefined)."""
    result = []
    for value in values:
        if isinstance(value, bool):
            result.append(1.0 if value else 0.0)
        elif isinstance(value, (int, float)) and math.isfinite(value):
            result.append(float(value))
    return result


def bootstrap_ci(values: Sequence[float], iters: int = BOOTSTRAP_ITERS, alpha: float = ALPHA, seed: int = SEED) -> Optional[CI]:
    """Percentile bootstrap CI of the mean, seeded so tables regenerate identically."""
    import numpy as np

    data = np.asarray(list(values), dtype=float)
    if data.size == 0:
        return None
    rng = np.random.default_rng(seed)
    means = data[rng.integers(0, data.size, size=(iters, data.size))].mean(axis=1)
    lower, upper = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return CI(float(data.mean()), float(lower), float(upper), int(data.size))


# --- single-turn results -------------------------------------------------------------------

SINGLE_TURN_METRICS = {
    "correctness": "judge",
    "faithfulness": "faithfulness",
    "citation_precision": "citationPrecision",
    "recall_at_5": "recallAt5",
    "abstention": "abstentionCorrect",
}

_RUN_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}")


def _run_sort_key(path: Path) -> str:
    match = _RUN_STAMP.search(path.stem)
    return match.group(0) if match else path.stem


def latest_single_turn_runs(results_dir: Path = RESULTS_DIR) -> Dict[str, Path]:
    """Latest run file per config (A0..A3). Run ids look like A1-2026-11-24T10-00-00-abc123."""
    latest: Dict[str, Path] = {}
    for path in sorted((results_dir / "single_turn").glob("*.jsonl"), key=_run_sort_key):
        config = path.stem.split("-", 1)[0]
        latest[config] = path
    return latest


def load_single_turn(paths: Dict[str, Path]) -> Dict[str, List[Dict[str, Any]]]:
    """Scored rows per config; error / infrastructure rows are excluded like in the runner."""
    return {config: [row for row in read_jsonl(path) if "error" not in row] for config, path in paths.items()}


def single_turn_cis(rows: List[Dict[str, Any]]) -> Dict[str, Optional[CI]]:
    return {metric: bootstrap_ci(finite(row.get(field) for row in rows)) for metric, field in SINGLE_TURN_METRICS.items()}


# --- trajectory results --------------------------------------------------------------------


@dataclass(frozen=True)
class TrajectoryRun:
    run_id: str
    summary: Dict[str, Any]
    rows_path: Path

    @property
    def conditions(self) -> Dict[str, Dict[str, Any]]:
        return {c["condition"]: c for c in self.summary.get("conditions", [])}

    def rows(self) -> List[Dict[str, Any]]:
        return read_jsonl(self.rows_path)


def load_trajectory_runs(results_dir: Path = RESULTS_DIR) -> List[TrajectoryRun]:
    runs = []
    for summary_path in sorted((results_dir / "trajectories").glob("*.summary.json")):
        run_id = summary_path.name[: -len(".summary.json")]
        rows_path = summary_path.with_name(f"{run_id}.jsonl")
        if rows_path.exists():
            runs.append(TrajectoryRun(run_id, json.loads(summary_path.read_text(encoding="utf-8")), rows_path))
    return runs


def pick_trajectory_run(runs: List[TrajectoryRun], run_id: Optional[str] = None) -> Optional[TrajectoryRun]:
    """The named run, else the run covering the most memory conditions (ties: last by id)."""
    if run_id:
        for run in runs:
            if run.run_id == run_id:
                return run
        raise SystemExit(f"No trajectory run {run_id} in results/trajectories")
    if not runs:
        return None
    return sorted(runs, key=lambda r: (len(r.conditions), r.run_id))[-1]


def calibration_pairs(rows: List[Dict[str, Any]]) -> List[tuple]:
    """(p_c, actual) for seen known/gap concepts from each structured trajectory's last state.

    Mirrors calibrationPairs in learn/eval/trajectory-metrics.ts (known = 1, gap = 0).
    """
    last: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        if row.get("memory") != "structured" or row.get("retrievalFailed") or row.get("error") or not row.get("state"):
            continue
        key = (row["personaId"], row.get("seed"), row.get("condition"))
        if key not in last or row["turn"] >= last[key]["turn"]:
            last[key] = row

    pairs = []
    for row in last.values():
        labels = {cid: 1 for cid in row["hidden"]["known"]}
        labels.update({cid: 0 for cid in row["hidden"]["gaps"]})
        concepts = row["state"]["concepts"]
        for concept_id, actual in labels.items():
            state = concepts.get(concept_id)
            if state and (state.get("observations", 0) > 0 or state.get("lastSeenTurn") is not None):
                pairs.append((float(state["mastery"]), actual))
    return pairs
