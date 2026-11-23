#!/usr/bin/env python3
"""Vector PDF figures for the paper from committed results (J4).

    python analysis/make_plots.py [--results results] [--out paper/figures] [--traj-run <runId>]
        [--personas p01-chain-rule-gap p02-dropout-overfitting-gap]

Writes (each only when its inputs exist):
  ablation.pdf      (a) A0-A3 single-turn metrics, grouped bars with 95% CI
  memory.pdf        (b) M0/M1/M1b/M2 gap F1, unnecessary remediation, next-action accuracy with 95% CI
  mastery.pdf       (c) p_c per turn for two example personas under M2
  calibration.pdf   (d) reliability of M2 mastery estimates vs. hidden mastery

Fonts are embedded as TrueType (pdf.fonttype 42), so `pdffonts` lists them and text stays text.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from common import (  # noqa: E402
    ABLATION_ORDER,
    CI,
    MEMORY_ORDER,
    PAPER_DIR,
    RESULTS_DIR,
    TrajectoryRun,
    calibration_pairs,
    latest_single_turn_runs,
    load_single_turn,
    load_trajectory_runs,
    pick_trajectory_run,
    single_turn_cis,
)

# Validated categorical palette (light): fixed order, never cycled. Slot i always means the i-th
# condition of a ladder, so A2 and M1b share a hue only because both are "third in their ladder".
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
# Secondary encoding for grayscale print / colour-vision deficiency.
HATCHES = ["", "///", "...", "xxx"]
SURFACE = "#ffffff"
TEXT = "#0b0b0b"
TEXT_MUTED = "#52514e"
GRID = "#e4e3df"
GAP_THRESHOLD = 0.6  # τ_gap (DEFAULT_THRESHOLDS.gap)

COLUMN_WIDTH = 3.5  # IEEE single column, inches

ABLATION_METRICS = [
    ("correctness", "Correct-\nness"),
    ("faithfulness", "Faithful-\nness"),
    ("citation_precision", "Citation\nprecision"),
    ("recall_at_5", "Recall@5"),
    ("abstention", "Abstention\naccuracy"),
]
MEMORY_METRICS = [
    ("gapF1", "Gap F1 ↑"),
    ("unnecessaryRemediation", "Unnecessary\nremediation ↓"),
    ("nextActionAccuracy", "Next-action\naccuracy ↑"),
]


def apply_style() -> None:
    plt.rcParams.update({
        "pdf.fonttype": 42,
        "hatch.linewidth": 0.35,
        "ps.fonttype": 42,
        "font.family": "DejaVu Sans",
        "font.size": 7,
        "axes.edgecolor": TEXT_MUTED,
        "axes.labelcolor": TEXT,
        "axes.linewidth": 0.6,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "xtick.color": TEXT_MUTED,
        "ytick.color": TEXT_MUTED,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "legend.frameon": False,
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "savefig.facecolor": SURFACE,
    })


def _recessive_grid(ax) -> None:
    ax.yaxis.grid(True, color=GRID, linewidth=0.5)
    ax.set_axisbelow(True)


def grouped_bars(
    ax,
    groups: Sequence[str],
    series: Sequence[str],
    values: Dict[str, Dict[str, Optional[CI]]],
    group_labels: Sequence[str],
) -> None:
    """One cluster per group, one bar per series, asymmetric 95% CI whiskers; missing = no bar."""
    width = 0.8 / len(series)
    for s_index, name in enumerate(series):
        xs, heights, lower, upper = [], [], [], []
        for g_index, group in enumerate(groups):
            ci = values[name].get(group)
            if ci is None:
                continue
            xs.append(g_index + (s_index - (len(series) - 1) / 2) * width)
            heights.append(ci.mean)
            lower.append(max(0.0, ci.mean - ci.lower))
            upper.append(max(0.0, ci.upper - ci.mean))
        ax.bar(
            xs, heights, width=width, color=SERIES[s_index], hatch=HATCHES[s_index], label=name,
            edgecolor=SURFACE, linewidth=0.8,  # surface gap between adjacent bars
        )
        ax.errorbar(xs, heights, yerr=[lower, upper], fmt="none", ecolor=TEXT, elinewidth=0.6, capsize=1.5, capthick=0.6)
    ax.set_xticks(range(len(groups)))
    ax.set_xticklabels(group_labels, fontsize=6.5)
    ax.set_ylim(0, 1.0)
    _recessive_grid(ax)


def _legend_above(ax, ncol: int) -> None:
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=ncol, handlelength=1.2, columnspacing=1.0, fontsize=6.5)


def plot_ablation(rows_by_config: Dict[str, List[dict]], out: Path) -> Optional[Path]:
    configs = [c for c in ABLATION_ORDER if c in rows_by_config]
    if not configs:
        return None
    values = {config: single_turn_cis(rows_by_config[config]) for config in configs}
    fig, ax = plt.subplots(figsize=(COLUMN_WIDTH, 1.9))
    grouped_bars(ax, [m for m, _ in ABLATION_METRICS], configs, values, [label for _, label in ABLATION_METRICS])
    ax.set_ylabel("Score (mean, 95% CI)")
    _legend_above(ax, len(configs))
    return _save(fig, out / "ablation.pdf")


def plot_memory(run: TrajectoryRun, out: Path) -> Optional[Path]:
    conditions = [c for c in MEMORY_ORDER if c in run.conditions]
    if not conditions:
        return None
    values = {c: {key: CI.from_summary(run.conditions[c].get(key)) for key, _ in MEMORY_METRICS} for c in conditions}
    fig, ax = plt.subplots(figsize=(COLUMN_WIDTH, 1.9))
    grouped_bars(ax, [m for m, _ in MEMORY_METRICS], conditions, values, [label for _, label in MEMORY_METRICS])
    ax.set_ylabel("Rate (mean, 95% CI)")
    _legend_above(ax, len(conditions))
    return _save(fig, out / "memory.pdf")


def mastery_series(rows: List[dict], persona_id: str) -> Dict[str, object]:
    """Per-turn p_c of the persona's gap and known concepts the tutor actually observed (M2)."""
    turns = sorted(
        (r for r in rows if r["personaId"] == persona_id and r.get("memory") == "structured" and r.get("state") and not r.get("error")),
        key=lambda r: r["turn"],
    )
    if not turns:
        return {}
    hidden = turns[0]["hidden"]
    final = turns[-1]["state"]["concepts"]
    observed = [cid for cid, s in final.items() if s.get("observations", 0) > 0 or s.get("lastSeenTurn") is not None]
    gaps = [cid for cid in hidden["gaps"] if cid in observed]
    known = [cid for cid in hidden["known"] if cid in observed][:3]
    return {
        "turns": [r["turn"] for r in turns],
        "distractors": [r["turn"] for r in turns if r.get("kind") == "distractor"],
        "lines": {cid: [r["state"]["concepts"].get(cid, {}).get("mastery") for r in turns] for cid in gaps + known},
        "gaps": gaps,
    }


def plot_mastery(rows: List[dict], personas: Sequence[str], out: Path) -> Optional[Path]:
    panels = [(pid, mastery_series(rows, pid)) for pid in personas]
    panels = [(pid, data) for pid, data in panels if data]
    if not panels:
        return None
    fig, axes = plt.subplots(len(panels), 1, figsize=(COLUMN_WIDTH, 1.6 * len(panels)), sharex=True, squeeze=False)
    for ax, (persona_id, data) in zip(axes[:, 0], panels):
        for turn in data["distractors"]:
            ax.axvspan(turn - 0.5, turn + 0.5, color=GRID, linewidth=0, zorder=0)
        ax.axhline(GAP_THRESHOLD, color=TEXT_MUTED, linewidth=0.6, linestyle=(0, (3, 2)))
        for cid, values in data["lines"].items():
            is_gap = cid in data["gaps"]
            ax.plot(
                data["turns"], values, color=SERIES[1] if is_gap else SERIES[0], linewidth=1.4 if is_gap else 1.0,
                linestyle="-" if is_gap else (0, (4, 1.5)), marker="o", markersize=2.5,
                markeredgecolor=SURFACE, markeredgewidth=0.5,  # surface ring on overlapping marks
            )
            last = next((v for v in reversed(values) if v is not None), None)
            if last is not None:
                ax.annotate(cid + (" (gap)" if is_gap else ""), (data["turns"][-1], last), xytext=(3, 0),
                            textcoords="offset points", va="center", fontsize=5.5, color=TEXT)
        ax.set_ylim(0, 1)
        ax.set_ylabel("p_c")
        ax.set_title(persona_id, fontsize=7, loc="left", color=TEXT)
        _recessive_grid(ax)
    axes[-1, 0].set_xlabel(f"Turn (shaded: distractor turn; gray dashed: τ_gap = {GAP_THRESHOLD})")
    fig.subplots_adjust(right=0.72, hspace=0.45)
    return _save(fig, out / "mastery.pdf", tight=False)


def reliability_bins(pairs: List[tuple], bins: int = 5) -> List[tuple]:
    """(mean predicted, fraction actually known, count) per equal-width p_c bin with data."""
    result = []
    for b in range(bins):
        low, high = b / bins, (b + 1) / bins
        members = [(p, a) for p, a in pairs if (low <= p < high) or (b == bins - 1 and p == 1.0)]
        if members:
            result.append((sum(p for p, _ in members) / len(members), sum(a for _, a in members) / len(members), len(members)))
    return result


def plot_calibration(rows: List[dict], run: TrajectoryRun, out: Path) -> Optional[Path]:
    pairs = calibration_pairs(rows)
    if not pairs:
        return None
    points = reliability_bins(pairs)
    fig, ax = plt.subplots(figsize=(COLUMN_WIDTH * 0.62, COLUMN_WIDTH * 0.62))
    ax.plot([0, 1], [0, 1], color=TEXT_MUTED, linewidth=0.6, linestyle=(0, (3, 2)), label="perfect")
    ax.plot([p for p, _, _ in points], [f for _, f, _ in points], color=SERIES[0], linewidth=1.2, marker="o",
            markersize=4, markeredgecolor=SURFACE, markeredgewidth=0.6, label="M2 (binned)")
    for p, f, n in points:
        # Above the point near the floor, below it elsewhere, so labels never hit the axis.
        ax.annotate(f"n={n}", (p, f), xytext=(4, 5 if f < 0.2 else -7), textcoords="offset points", fontsize=5.5, color=TEXT_MUTED)
    m2 = run.conditions.get("M2", {})
    brier, auc = CI.from_summary(m2.get("brier")), CI.from_summary(m2.get("auc"))
    if brier and auc:
        ax.text(0.02, 0.96, f"Brier {brier.mean:.3f}\nAUC {auc.mean:.2f}", va="top", fontsize=6, color=TEXT)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Predicted mastery p_c")
    ax.set_ylabel("Fraction actually known")
    ax.legend(loc="lower right", fontsize=6)
    _recessive_grid(ax)
    return _save(fig, out / "calibration.pdf")


def _save(fig, path: Path, tight: bool = True) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format="pdf", bbox_inches="tight" if tight else None, pad_inches=0.02)
    plt.close(fig)
    return path


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--results", type=Path, default=RESULTS_DIR)
    parser.add_argument("--out", type=Path, default=PAPER_DIR / "figures")
    parser.add_argument("--traj-run", default=None)
    parser.add_argument("--personas", nargs="+", default=["p01-chain-rule-gap", "p02-dropout-overfitting-gap"])
    args = parser.parse_args(argv)

    apply_style()
    written = {"ablation.pdf": plot_ablation(load_single_turn(latest_single_turn_runs(args.results)), args.out)}
    run = pick_trajectory_run(load_trajectory_runs(args.results), args.traj_run)
    rows = run.rows() if run else []
    written["memory.pdf"] = plot_memory(run, args.out) if run else None
    written["mastery.pdf"] = plot_mastery(rows, args.personas, args.out) if run else None
    written["calibration.pdf"] = plot_calibration(rows, run, args.out) if run else None

    for name, path in written.items():
        print(f"wrote {path}" if path else f"skip {name}: no results yet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
