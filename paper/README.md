# Paper (IEEE conference format)

Build it with [tectonic](https://tectonic-typesetting.github.io/), which fetches LaTeX packages automatically:

```bash
cd paper && tectonic main.tex     # → main.pdf
```

**Section owners** (see `docs/WORKPLAN.md`):

| Owner | Sections |
|---|---|
| Eshan | `01_introduction`, `03_method`, `06_conclusion`, `main.tex` |
| Joao | `02_related_work`, `04_experiments`, `05_failure_analysis` |

**Rules:**
- Every number in the paper comes from a committed results file through `analysis/make_tables.py`.
- Red `\todo{}` marks stay until such a number exists.
- Figures are vector: TikZ in `figures/`, or matplotlib PDFs from `analysis/make_plots.py`.
