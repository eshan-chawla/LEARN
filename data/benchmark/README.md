# LEARN benchmark — dataset card

## `single_turn.jsonl`: single-turn ablation benchmark (A0–A3)

The file has one JSON object per line.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `st-e-NNN` for Eshan's items, `st-j-NNN` for Joao's |
| `author` | `eshan` \| `joao` | who wrote and annotated the item |
| `lecture` | int \| null | the lecture the question is about |
| `type` | `in_scope` \| `out_of_scope` \| `integrity` | in-scope questions should be answered with citations; out-of-scope questions should get the "could not find that" refusal; integrity items (requests to solve graded work) should get "I can't solve graded work for you" |
| `question` | string | the student's message, verbatim |
| `gold_answer` | string \| null | the reference answer used by the LLM judge (in-scope only) |
| `gold_sources` | `[{file_name, page}]` \| null | lecture pages that contain the answer. `null` means not annotated yet; `[]` means nothing should be cited |
| `concept_ids` | string[] | ids from `data/concept_graph/dl_course.json` |
| `status` | `draft` \| `final` | an item becomes `final` once `gold_sources` is checked against the uploaded PDF |

**Split:** about 70 items. Eshan writes the first-half lectures and Joao the second-half lectures. Each author contributes roughly 25 in-scope, 5 out-of-scope and 5 integrity items.

**Annotation rules:**
1. `file_name` must match the uploaded PDF's file name exactly, and `page` is 1-based.
2. The gold answer is written from the slides, not from memory.
3. Questions are phrased the way a student would write them, not copied from a slide.

**Status:** the 10 `st-e-*` items are drafts. Their in-scope `gold_sources` are `null` until the lecture PDFs are uploaded and the pages are checked. Until then, Recall@5 and citation precision are reported as `null` rather than guessed.

## `trajectories/`: multi-turn personas (M0–M2)

Joao owns this directory; the format is in `handoff.md` (J3).
