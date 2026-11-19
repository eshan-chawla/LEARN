import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAskAiModel, convertToOpenAiMessages, type AskAiContent } from '@/lib/ask-ai/chat-provider';

describe('convertToOpenAiMessages', () => {
  it('maps a tool-call round trip to OpenAI-compatible messages', () => {
    const contents: AskAiContent[] = [
      { role: 'user', parts: [{ text: 'What is backprop?' }] },
      {
        role: 'model',
        parts: [{ functionCall: { id: 'call_1', name: 'search_class_pdfs', args: { query: 'backpropagation' } } }],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'call_1', name: 'search_class_pdfs', response: { result: 'Excerpt 1' } } }],
      },
    ];

    expect(convertToOpenAiMessages(contents)).toEqual([
      { role: 'user', content: 'What is backprop?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_class_pdfs', arguments: '{"query":"backpropagation"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Excerpt 1' },
    ]);
  });

  it('falls back to the tool name as id when the model gave none (forced tool calls)', () => {
    const messages = convertToOpenAiMessages([
      { role: 'model', parts: [{ functionCall: { name: 'search_class_pdfs', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'search_class_pdfs', response: { result: 'none' } } }] },
    ]);
    expect(messages[0]).toMatchObject({ tool_calls: [{ id: 'search_class_pdfs' }] });
    expect(messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'search_class_pdfs' });
  });
});

describe('callAskAiModel with GLM', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GLM_API_KEY = 'test-key';
    process.env.GLM_MODEL_ID = 'glm-test';
    process.env.GLM_BASE_URL = 'https://glm.example/v4/';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('sends JSON mode and tools, and parses a tool call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'abc', function: { name: 'search_class_pdfs', arguments: '{"query":"chain rule"}' } }],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAskAiModel([{ role: 'user', parts: [{ text: 'hi' }] }], 'glm-flash', {
      json: true,
      temperature: 0,
      tools: [
        {
          name: 'search_class_pdfs',
          description: 'search',
          parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] },
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://glm.example/v4/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('glm-test');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools[0].function.parameters.type).toBe('object');
    expect(body.tools[0].function.parameters.properties.query.type).toBe('string');
    expect(init.headers.Authorization).toBe('Bearer test-key');

    expect(result.functionCall).toEqual({ id: 'abc', name: 'search_class_pdfs', args: { query: 'chain rule' } });
  });

  it('fails clearly when GLM is not configured', async () => {
    delete process.env.GLM_MODEL_ID;
    await expect(callAskAiModel([{ role: 'user', parts: [{ text: 'hi' }] }], 'glm-flash')).rejects.toThrow(
      /GLM_API_KEY or GLM_MODEL_ID/
    );
  });

  it('surfaces provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }))
    );
    await expect(callAskAiModel([{ role: 'user', parts: [{ text: 'hi' }] }], 'glm-flash')).rejects.toThrow(
      'quota exceeded'
    );
  });
});
