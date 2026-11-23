from __future__ import annotations

import math

import pytest

from common import (
    CI,
    bootstrap_ci,
    calibration_pairs,
    finite,
    latest_single_turn_runs,
    load_single_turn,
    load_trajectory_runs,
    pick_trajectory_run,
    single_turn_cis,
)


def test_finite_converts_bools_and_drops_undefined():
    assert finite([True, False, None, float("nan"), 0.5, math.inf, 2]) == [1.0, 0.0, 0.5, 2.0]


def test_bootstrap_ci_is_seeded_and_brackets_the_mean():
    values = [0, 1, 1, 0, 1, 1, 1, 0, 1, 1]
    a = bootstrap_ci(values)
    assert a == bootstrap_ci(values)
    assert a != bootstrap_ci(values, seed=2)
    assert a.mean == pytest.approx(0.7)
    assert a.lower < 0.7 < a.upper
    assert a.n == 10


def test_bootstrap_ci_constant_and_empty():
    assert bootstrap_ci([0.5, 0.5]) == CI(0.5, 0.5, 0.5, 2)
    assert bootstrap_ci([]) is None


def test_ci_from_summary_reads_stats_ts_shape():
    ci = CI.from_summary({"estimate": 0.6, "lower": 0.5, "upper": 0.8, "n": 4})
    assert ci == CI(0.6, 0.5, 0.8, 4)
    assert ci.half_width == pytest.approx(0.15)
    assert CI.from_summary(None) is None


def test_latest_single_turn_run_per_config_and_error_rows_excluded(results_dir):
    paths = latest_single_turn_runs(results_dir)
    assert sorted(paths) == ["A0", "A1", "A2", "A3"]
    assert "2026-11-24" in paths["A1"].name
    rows = load_single_turn(paths)
    assert all(len(r) == 20 for r in rows.values())


def test_single_turn_cis_skip_undefined_metrics(results_dir):
    rows = load_single_turn(latest_single_turn_runs(results_dir))
    a0 = single_turn_cis(rows["A0"])
    assert a0["citation_precision"] is None
    assert a0["correctness"].n == 16  # out-of-scope items have no judge verdict
    assert single_turn_cis(rows["A3"])["faithfulness"].mean == pytest.approx(0.85)


def test_trajectory_runs_and_pick(results_dir):
    runs = load_trajectory_runs(results_dir)
    assert [r.run_id for r in runs] == ["smoke-scripted-s1"]
    run = pick_trajectory_run(runs)
    assert list(run.conditions) == ["M0", "M1", "M1b", "M2"]
    assert pick_trajectory_run([]) is None
    with pytest.raises(SystemExit):
        pick_trajectory_run(runs, "missing")


def test_calibration_pairs_use_last_structured_state_and_seen_concepts(results_dir):
    run = pick_trajectory_run(load_trajectory_runs(results_dir))
    pairs = calibration_pairs(run.rows())
    # 2 personas x (mlp known, derivatives known, chain_rule gap) from turn 5; M0 rows ignored.
    assert len(pairs) == 6
    assert (pytest.approx(0.8), 1) in [(pytest.approx(p), a) for p, a in pairs if a == 1]
    assert all(actual in (0, 1) for _, actual in pairs)
