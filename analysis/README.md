# Analysis: paper tables and figures (J4)

Every number and plot in the paper is regenerated from committed results files by these scripts.

## Regenerate everything

```bash
pip install -r analysis/requirements.txt
python analysis/make_all.py
```

This writes:

| Output | Source | Content |
|---|---|---|
| `paper/tables/single_turn_ablation.tex` | latest `results/single_turn/A{0..3}-*.jsonl` | A0–A3: correctness, faithfulness, citation precision, Recall@5, abstention |
| `paper/tables/memory_comparison.tex` | `results/trajectories/<run>.summary.json` | M0–M2: next-action accuracy, gap F1, turns-to-detection, unnecessary remediation, persistence, Brier, AUC |
| `paper/figures/ablation.pdf` | single-turn rows | (a) A0–A3 grouped bars with 95% CI |
| `paper/figures/memory.pdf` | trajectory summary | (b) M0/M1/M1b/M2: gap F1, unnecessary remediation, next-action accuracy with 95% CI |
| `paper/figures/mastery.pdf` | trajectory rows (M2) | (c) p_c per turn for two personas |
| `paper/figures/calibration.pdf` | trajectory rows (M2) | (d) reliability of mastery estimates |

**Missing inputs:** an output whose results don't exist yet is **skipped**, never filled with placeholder numbers.

**Choosing a trajectory run:** by default the scripts use the run that covers the most memory conditions. Pick a specific one with `--traj-run <runId>`, e.g. `--traj-run smoke-scripted-s1`.

You can also run the two scripts separately: `python analysis/make_tables.py` and `python analysis/make_plots.py`. Both take `--results` and `--out`. `make_plots.py` also takes `--personas` for figure (c).

## Where the numbers come from

- **Single-turn:** means and 95% CIs come from per-item rows, using a seeded percentile bootstrap (2000 resamples, seed 1). Error and infrastructure rows are excluded, as in `learn/eval/run-single-turn.ts`.
- **Trajectories:** the headline metrics and CIs are read from the run's `summary.json`, which `learn/eval/trajectory-metrics.ts` computes. The Python code doesn't re-implement those metrics, so the paper can't disagree with the tested code. Figures (c) and (d) only re-read the logged per-turn learner state.

Each table starts with a `%` comment naming the results files it was generated from.

## Using them in the paper

```latex
\input{tables/single_turn_ablation}
\input{tables/memory_comparison}

\begin{figure}[t]
  \centering
  \includegraphics[width=\columnwidth]{figures/memory.pdf}
  \caption{...}
  \label{fig:memory}
\end{figure}
```

`booktabs` and `graphicx` are already loaded in `paper/main.tex`.

## Checking the figures are vector

```bash
pdffonts paper/figures/memory.pdf    # lists embedded TrueType fonts; no Type 3
```

Zooming in should stay sharp. The tests check this automatically: no raster images, no Type 3 fonts, TrueType embedded.

## Figure style

- **Colors:** the conditions use a validated colorblind-safe palette in a fixed order (blue, orange, aqua, yellow).
- **Hatching:** each condition also has a hatch pattern, so bars stay distinguishable in grayscale print.
- **Error bars:** 95% CIs.

## Tests

```bash
pytest analysis
```

The tests build a synthetic results tree in the runners' exact format and check loading, CIs, table contents, figure output and the vector check. They make no network calls.
