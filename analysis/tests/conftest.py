"""Synthetic results trees shaped exactly like the TypeScript runners' output."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ANALYSIS_DIR = Path(__file__).resolve().parents[1]
if str(ANALYSIS_DIR) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_DIR))


def _ci(estimate, half, n):
    return {"estimate": estimate, "lower": estimate - half, "upper": estimate + half, "n": n}


def _state(mastery: dict, seen: set) -> dict:
    return {
        "schemaVersion": 1,
        "turn": 1,
        "concepts": {
            cid: {"conceptId": cid, "mastery": p, "observations": 1 if cid in seen else 0,
                  "lastSeenTurn": 0 if cid in seen else None, "misconceptions": {}}
            for cid, p in mastery.items()
        },
    }


def write_results(root: Path) -> Path:
    single = root / "results" / "single_turn"
    single.mkdir(parents=True)
    quality = {"A0": 0.3, "A1": 0.5, "A2": 0.6, "A3": 0.65}
    for config, q in quality.items():
        rows = []
        for i in range(20):
            rows.append({
                "runId": f"{config}-2026-11-24T10-00-00-aaaaaa", "itemId": f"st-{i}", "config": config,
                "itemType": "in_scope" if i < 16 else "out_of_scope",
                "judge": (i % 10) < q * 10 if i < 16 else None,
                "citationPrecision": None if config == "A0" else q,
                "recallAt5": None if config == "A0" else min(1.0, q + 0.1),
                "abstentionCorrect": i % 5 != 0,
                "faithfulness": None if config == "A0" else q + 0.2,
                "latencyTotalMs": 1000 + i,
            })
        rows.append({"runId": "x", "itemId": "st-err", "config": config, "error": "retrieval failed", "infrastructure": True})
        (single / f"{config}-2026-11-24T10-00-00-aaaaaa.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    # An older A1 run that must be ignored in favour of the latest.
    (single / "A1-2026-11-20T09-00-00-bbbbbb.jsonl").write_text(json.dumps({"config": "A1", "judge": False}) + "\n")

    traj = root / "results" / "trajectories"
    traj.mkdir(parents=True)
    run_id = "smoke-scripted-s1"
    conditions = []
    for k, condition in enumerate(["M0", "M1", "M1b", "M2"]):
        conditions.append({
            "condition": condition, "trajectories": 2, "scoredTurns": 20, "excludedTurns": 0,
            "nextActionAccuracy": _ci(0.3 + 0.15 * k, 0.1, 2),
            "unnecessaryRemediation": _ci(0.5 - 0.1 * k, 0.1, 2),
            "gapF1": _ci(0.2 + 0.2 * k, 0.15, 2),
            "turnsToDetection": _ci(6 - k, 1, 2) if k else None,
            "misconceptionDetectionRate": _ci(0.5, 0.2, 2),
            "misconceptionPersistenceRate": _ci(0.25 * k, 0.2, 2) if k else None,
            "brier": _ci(0.12, 0.03, 2) if condition == "M2" else None,
            "auc": _ci(0.9, 0.05, 2) if condition == "M2" else None,
            "gapMicro": {"precision": 0.5, "recall": 0.5, "f1": 0.5},
            "misconceptionFalseAlarms": 0, "maxMemoryChars": 1000 * (k + 1),
        })
    (traj / f"{run_id}.summary.json").write_text(json.dumps({"runId": run_id, "flags": {"sim": "scripted", "seed": 1}, "criticWired": False, "conditions": conditions}))

    hidden = {"known": ["mlp", "derivatives"], "gaps": ["chain_rule"], "misconceptions": ["backprop.M1"]}
    rows = []
    for persona, drift in [("p01-chain-rule-gap", 0.0), ("p02-dropout-overfitting-gap", 0.05)]:
        for turn in range(6):
            rows.append({
                "runId": run_id, "personaId": persona, "condition": "M2", "memory": "structured", "sim": "scripted", "seed": 1,
                "turn": turn, "kind": "distractor" if turn in (3, 4) else "respond", "action": None, "retrievalFailed": False, "error": None,
                "hidden": hidden,
                "state": _state({"mlp": 0.5 + 0.06 * turn, "derivatives": 0.6 + drift, "chain_rule": 0.4 - 0.05 * turn, "backprop": 0.3},
                                {"mlp", "chain_rule"} | ({"derivatives"} if turn > 1 else set())),
            })
            rows.append({**rows[-1], "condition": "M0", "memory": "none", "state": None})
    (traj / f"{run_id}.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return root / "results"


@pytest.fixture
def results_dir(tmp_path: Path) -> Path:
    return write_results(tmp_path)
