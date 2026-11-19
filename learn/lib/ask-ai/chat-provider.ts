import { getAskAiModelConfig, type AskAiModel } from '@/lib/ask-ai/models';

export interface AskAiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AskAiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface AskAiContentPart {
  text?: string;
  functionCall?: AskAiFunctionCall;
  functionResponse?: {
    id?: string;
    name: string;
    response: {
      result: string;
    };
  };
}

export interface AskAiContent {
  role: 'user' | 'model';
  parts: AskAiContentPart[];
}

export interface AskAiModelResponse {
  text: string;
  functionCall?: AskAiFunctionCall;
  content?: AskAiContent;
}

export interface AskAiCallOptions {
  tools?: AskAiFunctionDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider for a bare JSON object (no prose, no code fences). Callers still validate. */
  json?: boolean;
}

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 900;

function normalizeFunctionArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchema);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === 'type') {
        if (typeof entry === 'string') {
          return [key, entry.toLowerCase()];
        }

        if (Array.isArray(entry)) {
          return [
            key,
            entry.map((typeValue) =>
              typeof typeValue === 'string' ? typeValue.toLowerCase() : typeValue
            ),
          ];
        }
      }

      return [key, normalizeJsonSchema(entry)];
    })
  );
}

async function callGemini(
  contents: AskAiContent[],
  model: AskAiModel,
  options: AskAiCallOptions
): Promise<AskAiModelResponse> {
  const tools = options.tools ?? [];
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY on the server');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          topP: 0.9,
          maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
        contents,
        ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
      }),
      cache: 'no-store',
    }
  );

  const payload = await response.json().catch(() => null) as
    | {
        candidates?: Array<{
          content?: {
            parts?: AskAiContentPart[];
          };
        }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Gemini request failed');
  }

  const answer = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  const content = payload?.candidates?.[0]?.content
    ? ({
        role: 'model',
        parts: payload.candidates[0].content.parts || [],
      } satisfies AskAiContent)
    : undefined;
  const functionCall = payload?.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;

  if (!answer && !functionCall) {
    throw new Error('Gemini returned an empty response');
  }

  return { text: answer || '', functionCall, content };
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Converts the provider-neutral (Gemini-shaped) history into OpenAI-compatible chat messages. */
export function convertToOpenAiMessages(contents: AskAiContent[]): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [];

  for (const content of contents) {
    const text = content.parts.map((part) => part.text || '').join('');

    if (content.role === 'model') {
      const toolCalls = content.parts
        .filter((part) => part.functionCall)
        .map((part): OpenAiToolCall => ({
          id: part.functionCall!.id || part.functionCall!.name,
          type: 'function',
          function: {
            name: part.functionCall!.name,
            arguments: JSON.stringify(normalizeFunctionArgs(part.functionCall!.args)),
          },
        }));
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    for (const part of content.parts) {
      if (part.functionResponse) {
        messages.push({
          role: 'tool',
          tool_call_id: part.functionResponse.id || part.functionResponse.name,
          content: part.functionResponse.response.result,
        });
      }
    }
    if (text) {
      messages.push({ role: 'user', content: text });
    }
  }

  return messages;
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return normalizeFunctionArgs(raw);
  try {
    return normalizeFunctionArgs(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * GLM (open-weight) through an OpenAI-compatible chat-completions endpoint.
 * Configure GLM_API_KEY, GLM_MODEL_ID, and optionally GLM_BASE_URL.
 */
async function callGlm(
  contents: AskAiContent[],
  options: AskAiCallOptions
): Promise<AskAiModelResponse> {
  const apiKey = process.env.GLM_API_KEY;
  const modelId = process.env.GLM_MODEL_ID;
  const baseUrl = (process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '');

  if (!apiKey || !modelId) {
    throw new Error('Missing GLM_API_KEY or GLM_MODEL_ID on the server');
  }

  const tools = options.tools ?? [];
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: convertToOpenAiMessages(contents),
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      top_p: 0.9,
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: normalizeJsonSchema(tool.parameters),
              },
            })),
          }
        : {}),
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
          };
        }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `GLM request failed (${response.status})`);
  }

  const message = payload?.choices?.[0]?.message;
  const answer = (message?.content || '').trim();
  const toolCall = message?.tool_calls?.find((call) => call.function?.name);
  const functionCall = toolCall?.function?.name
    ? {
        id: toolCall.id,
        name: toolCall.function.name,
        args: parseToolArguments(toolCall.function.arguments),
      }
    : undefined;

  if (!answer && !functionCall) {
    throw new Error('GLM returned an empty response');
  }

  const parts: AskAiContentPart[] = [];
  if (answer) parts.push({ text: answer });
  if (functionCall) parts.push({ functionCall });

  return { text: answer, functionCall, content: { role: 'model', parts } };
}

export async function callAskAiModel(
  contents: AskAiContent[],
  model: AskAiModel,
  options: AskAiCallOptions = {}
) {
  const provider = getAskAiModelConfig(model).provider;

  if (provider === 'glm') {
    return callGlm(contents, options);
  }

  return callGemini(contents, model, options);
}
