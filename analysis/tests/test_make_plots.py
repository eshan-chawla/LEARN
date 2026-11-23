from __future__ import annotations

import re

import pytest

from common import load_trajectory_runs, pick_trajectory_run
from make_plots import main, mastery_series, reliability_bins

FIGURES = ["ablation.pdf", "memory.pdf", "mastery.pdf", "calibration.pdf"]


def assert_vector_pdf(path):
    data = path.read_bytes()
    assert data.startswith(b"%PDF")
    assert b"/Subtype /Image" not in data, f"{path.name} contains a raster image"
    # pdf.fonttype 42 embeds TrueType fonts, so text stays selectable and pdffonts lists them.
    assert b"/FontFile2" in data, f"{path.name} has no embedded TrueType font"
    assert not re.search(rb"/Type\s*/Font\s*/Subtype\s*/Type3", data), f"{path.name} uses Type 3 fonts"


def test_main_writes_all_four_vector_figures(results_dir, tmp_path):
    out = tmp_path / "figures"
    assert main(["--results", str(results_dir), "--out", str(out)]) == 0
    for name in FIGURES:
        assert_vector_pdf(out / name)


def test_missing_results_skip_every_figure(tmp_path, capsys):
    empty = tmp_path / "results"
    (empty / "single_turn").mkdir(parents=True)
    (empty / "trajectories").mkdir()
    out = tmp_path / "figures"
    assert main(["--results", str(empty), "--out", str(out)]) == 0
    assert not out.exists() or list(out.iterdir()) == []
    assert capsys.readouterr().out.count("skip") == 4


def test_mastery_series_tracks_observed_gap_and_known_concepts(results_dir):
    rows = pick_trajectory_run(load_trajectory_runs(results_dir)).rows()
    series = mastery_series(rows, "p01-chain-rule-gap")
    assert series["turns"] == list(range(6))
    assert series["distractors"] == [3, 4]
    assert series["gaps"] == ["chain_rule"]
    assert set(series["lines"]) == {"chain_rule", "mlp", "derivatives"}
    assert series["lines"]["chain_rule"][0] == pytest.approx(0.4)
    assert mastery_series(rows, "no-such-persona") == {}


def test_reliability_bins():
    pairs = [(0.05, 0), (0.15, 0), (0.55, 1), (0.45, 0), (0.95, 1), (1.0, 1)]
    bins = reliability_bins(pairs, bins=5)
    assert [n for _, _, n in bins] == [2, 2, 2]
    assert bins[0] == (pytest.approx(0.1), 0.0, 2)
    assert bins[1][1] == 0.5
    assert bins[-1] == (pytest.approx(0.975), 1.0, 2)
