/**
 * Memory baselines for the M0–M2 comparison. Every condition is given the same character budget
 * for its memory block, so differences come from *what* is remembered, not how much.
 */
export interface ChatTurn {
  role: 'student' | 'tutor';
  content: string;
}

export const DEFAULT_MEMORY_CHAR_BUDGET = 4000;

export function clampToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(0, budget - 1))}…`;
}

function formatTurn(turn: ChatTurn): string {
  return `${turn.role === 'student' ? 'Student' : 'Tutor'}: ${turn.content}`;
}

/** M1: the most recent whole turns that fit in the budget, oldest first. */
export function rawHistoryBlock(history: ChatTurn[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const line = formatTurn(history[i]);
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    // The newest turn is always kept (tail-truncated if it alone exceeds the budget), so a long
    // tutor reply never leaves M1 with an empty memory.
    if (kept.length === 0 && cost > budget) return clampToBudget(line, budget);
    if (used + cost > budget) break;
    kept.unshift(line);
    used += cost;
  }
  return kept.join('\n');
}

/**
 * Memory block for M1b and M2: the previous tutor message gets a reserved share of the budget
 * (it is what a short follow-up answer refers to), the summary/state block gets the rest.
 * Reserving it first keeps the comparison fair when the summary or state block is long.
 */
export function composeMemoryBlock(main: string, previousTutorMessage: string | null, budget: number): string {
  const tutorLine = clampToBudget(`Tutor's previous message: ${previousTutorMessage ?? '(none)'}`, Math.floor(budget / 2));
  const remaining = budget - tutorLine.length - 1;
  return remaining > 0 ? `${clampToBudget(main, remaining)}\n${tutorLine}` : tutorLine;
}

/** M1b: prompt that folds the latest exchange into a rolling summary of the student. */
export function buildSummaryPrompt(previous: string | null, student: string, tutor: string, budget: number): string {
  return [
    'You maintain a running summary of a tutoring conversation in a deep learning course.',
    `Rewrite the summary to include the latest exchange. Keep it under ${budget} characters.`,
    'Focus on what the student seems to know, what they got wrong, misconceptions they expressed, and what the tutor asked them last.',
    'Output only the new summary text.',
    '',
    `Previous summary: ${previous ?? '(none)'}`,
    `Student: ${student}`,
    `Tutor: ${tutor}`,
  ].join('\n');
}

export function lastTutorMessage(history: ChatTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'tutor') return history[i].content;
  }
  return null;
}
