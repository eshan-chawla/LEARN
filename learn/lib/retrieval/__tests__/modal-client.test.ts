import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapModalHit, RetrievalError, searchModalRetrieval } from '@/lib/retrieval/modal-client';

const ENV = { url: 'https://modal.example/search', secret: 's3cret' };

function okResponse(hits: unknown[]) {
  return new Response(JSON.stringify({ success: true, hits, total: hits.length }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchModalRetrieval', () => {
  it('sends mode only when provided', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ success: true, hits: [], mode: 'hybrid' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchModalRetrieval({ query: 'q', classId: 'c' }, ENV);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('mode');

    await searchModalRetrieval({ query: 'q', classId: 'c', mode: 'hybrid' }, ENV);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.mode).toBe('hybrid');
    expect(body.webhook_secret).toBe('s3cret');
    expect(body.class_id).toBe('c');
  });

  it('throws RetrievalError with the webhook error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    const promise = searchModalRetrieval({ query: 'q', classId: 'c' }, ENV);
    await expect(promise).rejects.toBeInstanceOf(RetrievalError);
    await expect(searchModalRetrieval({ query: 'q', classId: 'c' }, ENV)).rejects.toThrow('boom');
  });

  it('throws a 500 RetrievalError when URL or secret is missing', async () => {
    const original = { ...process.env };
    delete process.env.MODAL_RETRIEVAL_WEBHOOK_URL;
    delete process.env.MODAL_WEBHOOK_SECRET;
    try {
      const error = await searchModalRetrieval({ query: 'q', classId: 'c' }).catch((e) => e);
      expect(error).toBeInstanceOf(RetrievalError);
      expect(error.status).toBe(500);
      expect(error.message).toMatch(/MODAL_RETRIEVAL_WEBHOOK_URL/);
    } finally {
      process.env = original;
    }
  });
});

describe('mapModalHit', () => {
  it('maps conceptIds and ignores non-string entries', () => {
    expect(mapModalHit({ text: 't', conceptIds: ['backprop', 3] }).conceptIds).toEqual(['backprop']);
    expect(mapModalHit({ text: 't' }).conceptIds).toBeUndefined();
  });
});

describe('review fixes: timeout and mode echo', () => {
  it('aborts a hanging webhook and throws a timeout RetrievalError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
      )
    );
    const error = await searchModalRetrieval({ query: 'q', classId: 'c' }, { ...ENV, timeoutMs: 20 }).catch((e) => e);
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.message).toMatch(/timed out/i);
  });

  it('rejects a hybrid request the webhook did not serve as hybrid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => okResponse([])));
    await expect(searchModalRetrieval({ query: 'q', classId: 'c', mode: 'hybrid' }, ENV)).rejects.toThrow(/hybrid/);
    await expect(searchModalRetrieval({ query: 'q', classId: 'c', mode: 'dense' }, ENV)).resolves.toMatchObject({ hits: [] });
  });

  it('accepts a hybrid response that echoes the mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, hits: [], mode: 'hybrid' }), { status: 200 }))
    );
    await expect(searchModalRetrieval({ query: 'q', classId: 'c', mode: 'hybrid' }, ENV)).resolves.toMatchObject({ hits: [] });
  });
});
