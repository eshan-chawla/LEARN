import type { RetrievalHit, RetrievalSearchRequest, RetrievalSearchResponse } from '@/lib/retrieval/types';

/**
 * Headless client for the Modal retrieval webhook. No Next.js imports, so the
 * eval runners (tsx) and the API routes share exactly the same retrieval code.
 */
export class RetrievalError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RetrievalError';
    this.status = status;
  }
}

export function mapModalHit(hit: Record<string, unknown>): RetrievalHit {
  const contentType = hit.contentType === 'video' ? 'video' : 'pdf';
  const mapped: RetrievalHit = {
    score: typeof hit.score === 'number' ? hit.score : 0,
    text: typeof hit.text === 'string' ? hit.text : '',
    classId: typeof hit.classId === 'string' ? hit.classId : '',
    contentType,
    sourceId: typeof hit.sourceId === 'string' ? hit.sourceId : '',
    title: typeof hit.title === 'string' ? hit.title : null,
    fileName: typeof hit.fileName === 'string' ? hit.fileName : null,
    storagePath: typeof hit.storagePath === 'string' ? hit.storagePath : null,
    pageNumber: typeof hit.pageNumber === 'number' ? hit.pageNumber : null,
    pageChunkIndex: typeof hit.pageChunkIndex === 'number' ? hit.pageChunkIndex : null,
    chunkIndex: typeof hit.chunkIndex === 'number' ? hit.chunkIndex : null,
    startSeconds: typeof hit.startSeconds === 'number' ? hit.startSeconds : null,
    endSeconds: typeof hit.endSeconds === 'number' ? hit.endSeconds : null,
    transcriptChunkIndex: typeof hit.transcriptChunkIndex === 'number' ? hit.transcriptChunkIndex : null,
    transcriptLanguage: typeof hit.transcriptLanguage === 'string' ? hit.transcriptLanguage : null,
  };

  if (Array.isArray(hit.conceptIds)) {
    mapped.conceptIds = hit.conceptIds.filter((id): id is string => typeof id === 'string');
  }
  return mapped;
}

/** Keeps a hung or cold-starting webhook from consuming the whole serverless time budget. */
export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 15_000;

export async function searchModalRetrieval(
  input: RetrievalSearchRequest,
  env: { url?: string; secret?: string; timeoutMs?: number } = {}
): Promise<RetrievalSearchResponse> {
  const url = env.url ?? process.env.MODAL_RETRIEVAL_WEBHOOK_URL;
  const secret = env.secret ?? process.env.MODAL_WEBHOOK_SECRET;

  if (!url || !secret) {
    throw new RetrievalError(
      'Retrieval is not configured. Set MODAL_RETRIEVAL_WEBHOOK_URL and MODAL_WEBHOOK_SECRET.',
      500
    );
  }

  const timeoutMs = env.timeoutMs ?? (Number(process.env.MODAL_RETRIEVAL_TIMEOUT_MS) || DEFAULT_RETRIEVAL_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook_secret: secret,
        query: input.query,
        class_id: input.classId,
        content_types: input.contentTypes,
        source_ids: input.sourceIds,
        limit: input.limit,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error || error instanceof DOMException ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new RetrievalError(`Retrieval timed out after ${timeoutMs} ms`, 504);
    }
    throw new RetrievalError(`Retrieval request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RetrievalError(typeof payload?.error === 'string' ? payload.error : 'Failed to search content', 500);
  }

  if (!payload?.success || !Array.isArray(payload?.hits)) {
    throw new RetrievalError(
      typeof payload?.error === 'string' ? payload.error : 'Retrieval service returned an invalid response',
      500
    );
  }

  // A webhook without hybrid support ignores `mode` and silently serves dense results, which would
  // make A2 indistinguishable from A1. Hybrid-capable webhooks echo the mode they served.
  if (input.mode === 'hybrid' && payload.mode !== 'hybrid') {
    throw new RetrievalError('Hybrid retrieval was requested but the webhook did not serve it (deploy hybrid retrieval, J1).', 501);
  }

  return {
    query: input.query,
    classId: input.classId,
    hits: payload.hits.map((hit: Record<string, unknown>) => mapModalHit(hit)),
    total: typeof payload.total === 'number' ? payload.total : payload.hits.length,
  };
}
