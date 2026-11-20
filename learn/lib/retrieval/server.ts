import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/lib/supabase';
import { RetrievalError, searchModalRetrieval } from '@/lib/retrieval/modal-client';
import type {
  RetrievalContentType,
  RetrievalSearchRequest,
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

export async function handleRetrievalSearch(
  request: NextRequest,
  options: RetrievalRouteOptions = {}
): Promise<NextResponse> {
  try {
    const token = requireBearerToken(request);
    const body = await parseRequestBody(request);
    const input = normalizeSearchRequest(body, options);

    await authorizeClassAccess(token, input.classId);
    const response = await searchModalRetrieval(input);

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof HttpError || error instanceof RetrievalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Retrieval error:', error);
    return NextResponse.json({ error: 'Failed to search content' }, { status: 500 });
  }
}
