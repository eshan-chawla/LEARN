export const DEFAULT_ASK_AI_GEMINI_MODEL = 'gemini-2.5-flash-lite';

export const ASK_AI_GEMINI_MODELS = [
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Flash-Lite',
    description: 'Fastest, lowest cost',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Flash',
    description: 'Balanced reasoning',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Pro',
    description: 'Best for hard questions',
  },
] as const;

export type AskAiGeminiModel = (typeof ASK_AI_GEMINI_MODELS)[number]['id'];

export function normalizeAskAiGeminiModel(
  value: unknown,
  fallback: AskAiGeminiModel = DEFAULT_ASK_AI_GEMINI_MODEL
): AskAiGeminiModel {
  return ASK_AI_GEMINI_MODELS.some((model) => model.id === value)
    ? (value as AskAiGeminiModel)
    : fallback;
}

export function getAskAiGeminiModelLabel(modelId: AskAiGeminiModel) {
  return ASK_AI_GEMINI_MODELS.find((model) => model.id === modelId)?.label || modelId;
}
