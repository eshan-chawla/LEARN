import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/lib/supabase';
import type {
  RetrievalContentType,
  RetrievalHit,
  RetrievalSearchRequest,
  RetrievalSearchResponse,
} from '@/lib/retrieval/types';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const ALLOWED_CONTENT_TYPES = new Set<RetrievalContentType>(['pdf', 'video']);

interface RetrievalRouteOptions {
  classId?: string;
  contentTypes?: RetrievalContentType[];
}

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function requireBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError('Unauthorized', 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError('Unauthorized', 401);
  }

  return token;
}

function normalizeStringList(value: unknown, fieldName: string): string[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(`${fieldName} must be an array of strings`, 400);
  }

  const normalizedValues = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function normalizeContentTypes(
  value: unknown,
  fixedContentTypes?: RetrievalContentType[]
): RetrievalContentType[] | undefined {
  if (fixedContentTypes?.length) {
    return fixedContentTypes;
  }

  const normalizedValues = normalizeStringList(value, 'contentTypes');
  if (!normalizedValues) {
    return undefined;
  }

  const invalidValue = normalizedValues.find(
    (item): item is string => !ALLOWED_CONTENT_TYPES.has(item as RetrievalContentType)
  );
  if (invalidValue) {
    throw new HttpError(`Unsupported content type: ${invalidValue}`, 400);
  }

  return normalizedValues as RetrievalContentType[];
}

function normalizeLimit(value: unknown): number {
  if (value == null) {
    return DEFAULT_LIMIT;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new HttpError('limit must be a positive number', 400);
  }

  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

async function parseRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError('Request body must be a JSON object', 400);
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError('Invalid JSON request body', 400);
  }
}

function normalizeSearchRequest(
  body: Record<string, unknown>,
  options: RetrievalRouteOptions
): RetrievalSearchRequest {
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const classId = options.classId ?? (typeof body.classId === 'string' ? body.classId.trim() : '');

  if (!query) {
    throw new HttpError('Missing required field: query', 400);
  }

  if (!classId) {
    throw new HttpError('Missing required field: classId', 400);
  }

  return {
    query,
    classId,
    contentTypes: normalizeContentTypes(body.contentTypes, options.contentTypes),
    sourceIds: normalizeStringList(body.sourceIds, 'sourceIds'),
    limit: normalizeLimit(body.limit),
  };
}

async function authorizeClassAccess(token: string, classId: string): Promise<void> {
  const supabase = createSupabaseClient(token);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new HttpError('Unauthorized', 401);
  }

  const { data: classRow, error: classError } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .maybeSingle();

  if (classError) {
    throw new HttpError(classError.message || 'Failed to verify class access', 500);
  }

  if (!classRow) {
    throw new HttpError('Forbidden', 403);
  }
}

function mapModalHit(hit: Record<string, unknown>): RetrievalHit {
  const contentType = hit.contentType === 'video' ? 'video' : 'pdf';

  return {
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
  };
}

async function invokeModalRetrieval(
  input: RetrievalSearchRequest
): Promise<RetrievalSearchResponse> {
  const modalWebhookUrl = process.env.MODAL_RETRIEVAL_WEBHOOK_URL;
  const modalWebhookSecret = process.env.MODAL_WEBHOOK_SECRET;

  if (!modalWebhookUrl || !modalWebhookSecret) {
    throw new HttpError(
      'Retrieval is not configured. Set MODAL_RETRIEVAL_WEBHOOK_URL and MODAL_WEBHOOK_SECRET.',
      500
    );
  }

  const modalResponse = await fetch(modalWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhook_secret: modalWebhookSecret,
      query: input.query,
      class_id: input.classId,
      content_types: input.contentTypes,
      source_ids: input.sourceIds,
      limit: input.limit,
    }),
    cache: 'no-store',
  });

  const modalPayload = await modalResponse.json().catch(() => null);
  if (!modalResponse.ok) {
    throw new HttpError(
      typeof modalPayload?.error === 'string' ? modalPayload.error : 'Failed to search content',
      500
    );
  }

  if (!modalPayload?.success || !Array.isArray(modalPayload?.hits)) {
    throw new HttpError(
      typeof modalPayload?.error === 'string'
        ? modalPayload.error
        : 'Retrieval service returned an invalid response',
      500
    );
  }

  return {
    query: input.query,
    classId: input.classId,
    hits: modalPayload.hits.map((hit: Record<string, unknown>) => mapModalHit(hit)),
    total:
      typeof modalPayload.total === 'number' ? modalPayload.total : modalPayload.hits.length,
  };
}

export async function handleRetrievalSearch(
  request: NextRequest,
  options: RetrievalRouteOptions = {}
): Promise<NextResponse> {
  try {
    const token = requireBearerToken(request);
    const body = await parseRequestBody(request);
    const input = normalizeSearchRequest(body, options);

    await authorizeClassAccess(token, input.classId);
    const response = await invokeModalRetrieval(input);

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Retrieval error:', error);
    return NextResponse.json({ error: 'Failed to search content' }, { status: 500 });
  }
}
