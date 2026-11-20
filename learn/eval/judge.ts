/** LLM-as-judge for answer correctness against a reference answer (temperature 0, JSON). */
export interface JudgeVerdict {
  /** null when the judge output could not be parsed (counted as a judge error, not as wrong). */
  correct: 0 | 0.5 | 1 | null;
  reason: string;
}

export function buildJudgePrompt(input: { question: string; goldAnswer: string; answer: string }): string {
  return [
    'You grade answers from a deep learning course tutor against a reference answer.',
    'Score 1 if the candidate is correct and covers the key points of the reference, 0.5 if partially correct or incomplete, 0 if wrong, off-topic, or a refusal.',
    'Ignore style, length and citation markers like [1]. Do not reward content that contradicts the reference.',
    'Respond with JSON only: {"correct": 0 | 0.5 | 1, "reason": "<one sentence>"}',
    '',
    `Question: ${input.question}`,
    `Reference answer: ${input.goldAnswer}`,
    `Candidate answer: ${input.answer}`,
  ].join('\n');
}

export async function judgeCorrectness(
  input: { question: string; goldAnswer: string; answer: string },
  complete: (prompt: string) => Promise<string>
): Promise<JudgeVerdict> {
  const text = await complete(buildJudgePrompt(input));
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate.slice(candidate.indexOf('{'), candidate.lastIndexOf('}') + 1));
    const score = Number(parsed.correct);
    if (!Number.isFinite(score)) throw new Error('no score');
    const snapped = ([0, 0.5, 1] as const).reduce((best, v) => (Math.abs(v - score) < Math.abs(best - score) ? v : best));
    return { correct: snapped, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch {
    return { correct: null, reason: 'judge parse error' };
  }
}
