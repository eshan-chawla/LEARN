import { NextRequest, NextResponse } from 'next/server';
import {
  formatWebSearchContext,
  searchDuckDuckGoContext,
  type WebSearchResult,
} from '@/lib/ask-ai/duckduckgo';
import { buildAskAiGuardrailPrompt } from '@/lib/ask-ai/guardrails';
import {
  DEFAULT_ASK_AI_GEMINI_MODEL,
  normalizeAskAiGeminiModel,
  type AskAiGeminiModel,
} from '@/lib/ask-ai/models';
import { buildClassStructuralContext } from '@/lib/ask-ai/structural';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type ChatRole = 'user' | 'assistant';
type ResourceScope =
  | 'currentBook'
  | 'entireModule'
  | 'allBooks'
  | 'includeVideos'
  | 'includeWebData'
  | 'includeStructuralData';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface RetrievalHit {
  score: number;
  text: string;
  sourceId: string;
  contentType: 'pdf' | 'video';
  title: string | null;
  pageNumber: number | null;
  pageChunkIndex: number | null;
  chunkIndex: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
}

interface AskAiSource {
  pageNumber: number | null;
  excerpt: string;
  score: number;
  sourceId: string;
  contentType: 'pdf' | 'video' | 'web' | 'structural';
  title: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  url?: string;
}

interface RetrievalTarget {
  url: URL;
  body: {
    query: string;
    limit: number;
    sourceIds?: string[];
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }

  return fallback;
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    throw new Error('messages must be an array');
  }

  const normalized = value
    .map((message) => {
      if (!message || typeof message !== 'object') return null;

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;

      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return null;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) return null;

      return {
        role,
        content: trimmedContent.slice(0, 4000),
      } satisfies ChatMessage;
    })
    .filter((message): message is ChatMessage => message !== null);

  if (normalized.length === 0) {
    throw new Error('At least one chat message is required');
  }

  const latestMessage = normalized[normalized.length - 1];
  if (latestMessage.role !== 'user') {
    throw new Error('The latest chat message must be from the user');
  }

  return normalized.slice(-8);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeResourceScopes(value: unknown): Set<ResourceScope> {
  const scopes = new Set<ResourceScope>(['currentBook']);

  for (const candidate of normalizeStringList(value)) {
    if (candidate === 'currentBook' || candidate === 'entireModule') {
      scopes.add(candidate);
      continue;
    }

    if (candidate === 'allBooks' || candidate === 'entireClassModules') {
      scopes.add('allBooks');
      continue;
    }

    if (candidate === 'includeVideos' || candidate === 'entireClassContent') {
      scopes.add('includeVideos');
      continue;
    }

    if (candidate === 'includeWebData' || candidate === 'webData') {
      scopes.add('includeWebData');
      continue;
    }

    if (candidate === 'includeStructuralData' || candidate === 'structuralData') {
      scopes.add('includeStructuralData');
    }
  }

  return scopes;
}

function summarizeConversation(messages: ChatMessage[]) {
  return messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'Student' : 'Assistant'}: ${message.content}`)
    .join('\n\n');
}

function formatTimecode(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const rounded = Math.floor(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildContext(hits: RetrievalHit[], bookTitle: string) {
  return hits
    .map((hit, index) => {
      const locatorLabel = hit.contentType === 'video'
        ? [formatTimecode(hit.startSeconds) || 'Unknown start', formatTimecode(hit.endSeconds)]
            .filter(Boolean)
            .join(' - ')
        : hit.pageNumber
          ? `Page ${hit.pageNumber}`
          : 'Page unavailable';
      return [
        `Excerpt ${index + 1}`,
        `Source type: ${hit.contentType === 'video' ? 'Class recording transcript' : 'Book passage'}`,
        `Source title: ${hit.title || bookTitle}`,
        `Location: ${locatorLabel || (hit.contentType === 'video' ? 'Transcript excerpt' : 'Page unavailable')}`,
        hit.text,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function buildSources(
  hits: RetrievalHit[],
  webResults: WebSearchResult[] = [],
  structuralSources: AskAiSource[] = []
): AskAiSource[] {
  const seen = new Set<string>();

  const uploadedSources = hits
    .filter((hit) => {
      const key = [
        hit.contentType,
        hit.sourceId,
        hit.contentType === 'video' ? hit.startSeconds ?? 'none' : hit.pageNumber ?? 'none',
        hit.contentType === 'video' ? hit.endSeconds ?? 'none' : hit.pageChunkIndex ?? hit.chunkIndex ?? 'none',
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map((hit) => ({
      pageNumber: hit.pageNumber,
      excerpt: hit.text.length > 240 ? `${hit.text.slice(0, 237).trimEnd()}...` : hit.text,
      score: hit.score,
      sourceId: hit.sourceId,
      contentType: hit.contentType,
      title: hit.title,
      startSeconds: hit.startSeconds,
      endSeconds: hit.endSeconds,
    }));

  const webSources = webResults.slice(0, 4).map((result) => ({
    pageNumber: null,
    excerpt: result.snippet.length > 240 ? `${result.snippet.slice(0, 237).trimEnd()}...` : result.snippet,
    score: 0,
    sourceId: result.url,
    contentType: 'web' as const,
    title: result.title,
    startSeconds: null,
    endSeconds: null,
    url: result.url,
  }));

  return [...uploadedSources, ...webSources, ...structuralSources];
}

function describeResourceScope(scopes: Set<ResourceScope>, bookTitle: string) {
  const includesAllBooks = scopes.has('allBooks');
  const includesVideos = scopes.has('includeVideos');
  const includesEntireModule = scopes.has('entireModule') && !includesAllBooks;

  if (includesAllBooks && includesVideos) {
    return 'all books in the class plus indexed class recordings';
  }

  if (includesAllBooks) {
    return 'all books in the class';
  }

  if (includesEntireModule && includesVideos) {
    return `the current module around ${bookTitle} plus indexed class recordings`;
  }

  if (includesVideos) {
    return `the current book, ${bookTitle}, plus indexed class recordings`;
  }

  if (includesEntireModule) {
    return `the current module around ${bookTitle}`;
  }

  return `the current book, ${bookTitle}`;
}

function buildRetrievalTargets(
  request: NextRequest,
  classId: string,
  bookId: string,
  scopes: Set<ResourceScope>,
  moduleBookIds: string[],
  query: string
) {
  const targets: RetrievalTarget[] = [];
  const includesAllBooks = scopes.has('allBooks');
  const includesVideos = scopes.has('includeVideos');
  const includesEntireModule = scopes.has('entireModule') && moduleBookIds.length > 0 && !includesAllBooks;

  targets.push(
    includesAllBooks
      ? {
          url: new URL(`/api/retrieval/class/${classId}/pdf`, request.nextUrl.origin),
          body: {
            query,
            limit: includesVideos ? 6 : 8,
          },
        }
      : includesEntireModule
        ? {
            url: new URL(`/api/retrieval/class/${classId}/pdf`, request.nextUrl.origin),
            body: {
              query,
              sourceIds: Array.from(new Set([bookId, ...moduleBookIds])),
              limit: includesVideos ? 6 : 8,
            },
          }
        : {
            url: new URL(`/api/retrieval/class/${classId}/pdf`, request.nextUrl.origin),
            body: {
              query,
              sourceIds: [bookId],
              limit: includesVideos ? 6 : 8,
            },
          }
  );

  if (includesVideos) {
    targets.push({
      url: new URL(`/api/retrieval/class/${classId}/video`, request.nextUrl.origin),
      body: {
        query,
        limit: 4,
      },
    });
  }

  return targets;
}

function mergeRetrievalHits(hitGroups: RetrievalHit[][], limit = 8) {
  const seen = new Set<string>();

  return hitGroups
    .flat()
    .sort((left, right) => right.score - left.score)
    .filter((hit) => {
      const key = [
        hit.contentType,
        hit.sourceId,
        hit.pageNumber ?? 'none',
        hit.startSeconds ?? 'none',
        hit.endSeconds ?? 'none',
        hit.chunkIndex ?? 'none',
        hit.pageChunkIndex ?? 'none',
      ].join(':');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function callGemini(prompt: string, model: AskAiGeminiModel) {
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
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      }),
      cache: 'no-store',
    }
  );

  const payload = await response.json().catch(() => null) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
          finishReason?: string;
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

  if (!answer) {
    throw new Error('Gemini returned an empty response');
  }

  return answer;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { bookId } = await params;
    const classId = typeof body.classId === 'string' ? body.classId.trim() : '';
    const bookTitle = typeof body.bookTitle === 'string' ? body.bookTitle.trim() : 'Current book';
    const messages = normalizeMessages(body.messages);
    const resourceScopes = normalizeResourceScopes(body.resourceScopes);
    const moduleBookIds = normalizeStringList(body.moduleBookIds);
    const includeWebData = resourceScopes.has('includeWebData');
    const includeStructuralData = resourceScopes.has('includeStructuralData');
    const defaultModel = normalizeAskAiGeminiModel(
      process.env.GEMINI_CHAT_MODEL,
      DEFAULT_ASK_AI_GEMINI_MODEL
    );
    const selectedModel = normalizeAskAiGeminiModel(body.model, defaultModel);

    if (!classId) {
      return NextResponse.json({ error: 'Missing required field: classId' }, { status: 400 });
    }

    const latestUserMessage = messages[messages.length - 1];
    const retrievalTargets = buildRetrievalTargets(
      request,
      classId,
      bookId,
      resourceScopes,
      moduleBookIds,
      latestUserMessage.content
    );
    const [retrievalPayloads, webResults, structuralResult] = await Promise.all([
      Promise.all(
        retrievalTargets.map(async (target) => {
          const retrievalResponse = await fetch(target.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify(target.body),
            cache: 'no-store',
          });

          const retrievalPayload = await retrievalResponse.json().catch(() => null) as
            | { hits?: RetrievalHit[]; error?: string }
            | null;

          if (!retrievalResponse.ok) {
            throw new Error(retrievalPayload?.error || 'Failed to search the selected resources');
          }

          return Array.isArray(retrievalPayload?.hits) ? retrievalPayload.hits : [];
        })
      ),
      includeWebData ? searchDuckDuckGoContext(latestUserMessage.content) : Promise.resolve([]),
      includeStructuralData
        ? buildClassStructuralContext(authHeader.slice('Bearer '.length).trim(), classId)
        : Promise.resolve({ context: '', sources: [] }),
    ]);

    const hits = mergeRetrievalHits(retrievalPayloads);
    if (hits.length === 0 && webResults.length === 0 && !structuralResult.context) {
      return NextResponse.json({
        answer:
          includeWebData || includeStructuralData
            ? 'I could not find matching passages, web data, or class structure data for that question. Try asking with a more specific term, concept, or page reference.'
            : 'I could not find matching passages in the selected resources for that question. Try asking with a more specific term, concept, or page reference.',
        sources: [],
      });
    }

    const resourceScopeLabel = describeResourceScope(resourceScopes, bookTitle);

    const prompt = [
      'You are Smart Learn AI inside a book reader.',
      buildAskAiGuardrailPrompt(resourceScopeLabel, { includeWebData, includeStructuralData }),
      'Use short paragraphs. Use flat bullets only if they make the answer clearer.',
      '',
      `Current book title: ${bookTitle}`,
      `Resource scope: ${resourceScopeLabel}`,
      `Web data: ${includeWebData ? 'Enabled by the student' : 'Disabled'}`,
      `Structural search: ${includeStructuralData ? 'Enabled by the student' : 'Disabled'}`,
      `Gemini model: ${selectedModel}`,
      '',
      'Recent conversation:',
      summarizeConversation(messages),
      '',
      'Retrieved excerpts from the selected resources:',
      hits.length > 0 ? buildContext(hits, bookTitle) : 'No matching uploaded excerpts were found.',
      ...(includeWebData
        ? [
            '',
            'DuckDuckGo web context:',
            webResults.length > 0 ? formatWebSearchContext(webResults) : 'No DuckDuckGo web context was found.',
          ]
        : []),
      ...(includeStructuralData
        ? [
            '',
            'Class structure data from database:',
            structuralResult.context || 'No class structure data was found.',
          ]
        : []),
      '',
      `Student's latest question: ${latestUserMessage.content}`,
    ].join('\n');

    const answer = await callGemini(prompt, selectedModel);

    return NextResponse.json({
      answer,
      sources: buildSources(
        hits,
        includeWebData ? webResults : [],
        includeStructuralData ? structuralResult.sources : []
      ),
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to answer this question');
    console.error('Book Ask AI error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
