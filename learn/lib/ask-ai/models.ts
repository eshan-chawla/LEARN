export type AskAiModelProvider = 'gemini' | 'bedrock';

export const DEFAULT_ASK_AI_MODEL = 'gemini-2.5-flash-lite';
export const DEFAULT_ASK_AI_GEMINI_MODEL = DEFAULT_ASK_AI_MODEL;

export const ASK_AI_MODELS = [
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini Flash-Lite',
    description: 'Fastest, lowest cost',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini Flash',
    description: 'Balanced reasoning',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    label: 'Gemini Pro',
    description: 'Best for hard questions',
  },
  {
    id: 'bedrock:llama-3.3-70b-instruct',
    provider: 'bedrock',
    label: 'Llama 70B',
    description: 'AWS Bedrock, stronger Llama reasoning',
  },
  {
    id: 'bedrock:llama-3.1-8b-instruct',
    provider: 'bedrock',
    label: 'Llama 8B',
    description: 'AWS Bedrock, faster small Llama model',
  },
] as const;

export const ASK_AI_GEMINI_MODELS = ASK_AI_MODELS.filter((model) => model.provider === 'gemini');

export type AskAiModel = (typeof ASK_AI_MODELS)[number]['id'];
export type AskAiGeminiModel = Extract<AskAiModel, `gemini-${string}`>;

export function normalizeAskAiModel(
  value: unknown,
  fallback: AskAiModel = DEFAULT_ASK_AI_MODEL
): AskAiModel {
  return ASK_AI_MODELS.some((model) => model.id === value)
    ? (value as AskAiModel)
    : fallback;
}

export function normalizeAskAiGeminiModel(
  value: unknown,
  fallback: AskAiGeminiModel = DEFAULT_ASK_AI_GEMINI_MODEL
): AskAiGeminiModel {
  const normalized = normalizeAskAiModel(value, fallback);
  return normalized.startsWith('gemini-') ? (normalized as AskAiGeminiModel) : fallback;
}

export function getAskAiModelConfig(modelId: AskAiModel) {
  return ASK_AI_MODELS.find((model) => model.id === modelId) || ASK_AI_MODELS[0];
}

export function getAskAiModelLabel(modelId: AskAiModel) {
  return getAskAiModelConfig(modelId).label || modelId;
}

export function getAskAiGeminiModelLabel(modelId: AskAiGeminiModel) {
  return getAskAiModelLabel(modelId);
}
