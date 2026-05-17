import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message as BedrockMessage,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
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

function getBedrockModelId(model: AskAiModel) {
  if (model === 'bedrock:llama-3.3-70b-instruct') {
    return process.env.BEDROCK_LLAMA_70B_MODEL_ID || 'us.meta.llama3-3-70b-instruct-v1:0';
  }

  if (model === 'bedrock:llama-3.1-8b-instruct') {
    return process.env.BEDROCK_LLAMA_8B_MODEL_ID || 'us.meta.llama3-1-8b-instruct-v1:0';
  }

  return model;
}

function normalizeFunctionArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDocument(value: unknown): DocumentType {
  return value as DocumentType;
}

function normalizeJsonSchemaForBedrock(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaForBedrock);
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

      return [key, normalizeJsonSchemaForBedrock(entry)];
    })
  );
}

async function callGemini(
  contents: AskAiContent[],
  model: AskAiModel,
  tools: AskAiFunctionDeclaration[] = []
): Promise<AskAiModelResponse> {
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
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 900,
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

function convertToBedrockMessage(content: AskAiContent): BedrockMessage {
  return {
    role: content.role === 'model' ? 'assistant' : 'user',
    content: content.parts.map((part): ContentBlock => {
      if (part.functionCall) {
        return {
          toolUse: {
            toolUseId: part.functionCall.id || part.functionCall.name,
            name: part.functionCall.name,
            input: toDocument(normalizeFunctionArgs(part.functionCall.args)),
          },
        };
      }

      if (part.functionResponse) {
        return {
          toolResult: {
            toolUseId: part.functionResponse.id || part.functionResponse.name,
            content: [{ text: part.functionResponse.response.result }],
          },
        };
      }

      return { text: part.text || '' };
    }),
  };
}

function convertToBedrockTools(tools: AskAiFunctionDeclaration[]): Tool[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: toDocument(normalizeJsonSchemaForBedrock(tool.parameters)),
      },
    },
  }));
}

async function callBedrock(
  contents: AskAiContent[],
  model: AskAiModel,
  tools: AskAiFunctionDeclaration[] = []
): Promise<AskAiModelResponse> {
  const region = process.env.BEDROCK_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
  const client = new BedrockRuntimeClient({ region });
  const response = await client.send(
    new ConverseCommand({
      modelId: getBedrockModelId(model),
      messages: contents.map(convertToBedrockMessage),
      inferenceConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 900,
      },
      ...(tools.length > 0 ? { toolConfig: { tools: convertToBedrockTools(tools) } } : {}),
    })
  );

  const message = response.output?.message;
  const parts = message?.content || [];
  const answer = parts
    .map((part) => ('text' in part ? part.text || '' : ''))
    .join('')
    .trim();
  const toolUse = parts.find((part) => 'toolUse' in part && part.toolUse)?.toolUse;
  const functionCall = toolUse?.name
    ? {
        id: toolUse.toolUseId,
        name: toolUse.name,
        args: normalizeFunctionArgs(toolUse.input),
      }
    : undefined;
  const content = message
    ? ({
        role: 'model',
        parts: parts.map((part): AskAiContentPart => {
          if ('toolUse' in part && part.toolUse?.name) {
            return {
              functionCall: {
                id: part.toolUse.toolUseId,
                name: part.toolUse.name,
                args: normalizeFunctionArgs(part.toolUse.input),
              },
            };
          }

          return { text: 'text' in part ? part.text || '' : '' };
        }),
      } satisfies AskAiContent)
    : undefined;

  if (!answer && !functionCall) {
    throw new Error('Bedrock returned an empty response');
  }

  return { text: answer, functionCall, content };
}

export async function callAskAiModel(
  contents: AskAiContent[],
  model: AskAiModel,
  options: { tools?: AskAiFunctionDeclaration[] } = {}
) {
  const provider = getAskAiModelConfig(model).provider;
  const tools = options.tools || [];

  if (provider === 'bedrock') {
    return callBedrock(contents, model, tools);
  }

  return callGemini(contents, model, tools);
}
