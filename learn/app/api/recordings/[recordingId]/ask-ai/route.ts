import { NextRequest, NextResponse } from 'next/server';
import {
  formatWebSearchContext,
  searchDuckDuckGoContext,
  type WebSearchResult,
} from '@/lib/ask-ai/duckduckgo';
import { buildAskAiGuardrailPrompt } from '@/lib/ask-ai/guardrails';
import {
  DEFAULT_ASK_AI_MODEL,
  normalizeAskAiModel,
} from '@/lib/ask-ai/models';
import { buildClassStructuralContext } from '@/lib/ask-ai/structural';
import {
  callAskAiModel,
  type AskAiContent,
  type AskAiFunctionCall,
  type AskAiFunctionDeclaration,
} from '@/lib/ask-ai/chat-provider';

export const runtime = 'nodejs';
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

type AskAiStepKind = 'retrieval' | 'tool' | 'decision' | 'web' | 'structure' | 'generation';

interface AskAiStep {
  id: string;
  kind: AskAiStepKind;
  title: string;
  detail: string;
  query?: string;
  count?: number;
  sourceType?: 'pdf' | 'video' | 'web' | 'structural';
  scope?: string;
}

interface RetrievalTarget {
  url: URL;
  body: {
    query: string;
    limit: number;
    sourceIds?: string[];
  };
}

const SEARCH_CLASS_PDFS_FUNCTION: AskAiFunctionDeclaration = {
  name: 'search_class_pdfs',
  description:
    'Search all indexed PDF passages in this class. Call this only when the current recording, indexed video, class structure, and enabled web context are insufficient. Rewrite the student question into a focused retrieval query with concrete terms.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'A focused semantic retrieval query for searching all class PDFs.',
      },
    },
    required: ['query'],
  },
};

const QUERY_CLASS_STRUCTURE_FUNCTION: AskAiFunctionDeclaration = {
  name: 'query_class_structure',
  description:
    'Query the Supabase class database for structured class information. Call this only when the student asks about class organization, book or recording lists, sections/modules, processing statuses, upload dates, file sizes, or recording durations.',
  parameters: {
    type: 'OBJECT',
    properties: {},
  },
};

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

function normalizeUseExternalSources(body: { useExternalSources?: unknown }, scopes: Set<ResourceScope>) {
  if (typeof body.useExternalSources === 'boolean') {
    return body.useExternalSources;
  }

  return scopes.has('includeWebData');
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

function buildContext(hits: RetrievalHit[], recordingTitle: string) {
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
        `Source title: ${hit.title || recordingTitle}`,
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
    .map((hit) => ({
      pageNumber: hit.pageNumber,
      excerpt: hit.text.length > 240 ? `${hit.text.slice(0, 237).trimEnd()}...` : hit.text,
      score: hit.score,
      sourceId: hit.sourceId,
      contentType: hit.contentType,
      title: hit.title,
      startSeconds: hit.startSeconds,
      endSeconds: hit.endSeconds,
    }))
    .filter((source) => {
      const key = [
        source.contentType,
        source.sourceId,
        source.contentType === 'video' ? source.startSeconds ?? 'none' : source.pageNumber ?? 'none',
        source.contentType === 'video' ? source.endSeconds ?? 'none' : 'pdf',
      ].join(':');

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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

function describeResourceScope(recordingTitle: string) {
  return `the current recording, ${recordingTitle}, indexed class recordings, the class structure query tool when needed, and the all-class PDF search tool when needed`;
}

function createStep(
  id: string,
  kind: AskAiStepKind,
  title: string,
  detail: string,
  extra: Omit<Partial<AskAiStep>, 'id' | 'kind' | 'title' | 'detail'> = {}
): AskAiStep {
  return {
    id,
    kind,
    title,
    detail,
    ...extra,
  };
}

function shouldRepairBroadPdfToolDecision(answer: string, pdfContextHits: RetrievalHit[]) {
  const normalizedAnswer = answer.toLowerCase();

  return (
    pdfContextHits.length < 3 ||
    normalizedAnswer.includes('i could not find that in the selected resources') ||
    normalizedAnswer.includes('not covered in the selected resources') ||
    normalizedAnswer.includes('not enough information')
  );
}

function shouldForceBroadPdfToolFallback(answer: string, pdfContextHits: RetrievalHit[]) {
  const normalizedAnswer = answer.toLowerCase();

  return (
    pdfContextHits.length === 0 ||
    normalizedAnswer.includes('i could not find that in the selected resources') ||
    normalizedAnswer.includes('not covered in the selected resources')
  );
}

function getFunctionCallQuery(functionCall: AskAiFunctionCall, fallback: string) {
  return typeof functionCall.args?.query === 'string' && functionCall.args.query.trim()
    ? functionCall.args.query.trim()
    : fallback;
}

function describeToolDecision(functionCall: AskAiFunctionCall, fallbackQuery: string, modelText: string) {
  if (functionCall.name === 'search_class_pdfs') {
    const query = getFunctionCallQuery(functionCall, fallbackQuery);
    const reason = modelText.trim()
      ? ` Model note: ${modelText.trim()}`
      : '';

    return {
      title: 'Model requested PDF search',
      detail: `The selected model decided the current context may be insufficient and requested search_class_pdfs with the rewritten query "${query}".${reason}`,
      query,
      sourceType: 'pdf' as const,
      scope: 'all class PDFs',
    };
  }

  if (functionCall.name === 'query_class_structure') {
    const reason = modelText.trim()
      ? ` Model note: ${modelText.trim()}`
      : '';

    return {
      title: 'Model requested class structure',
      detail: `The selected model requested query_class_structure to inspect structured class metadata before answering.${reason}`,
      query: undefined,
      sourceType: 'structural' as const,
      scope: 'Supabase class database',
    };
  }

  return {
    title: 'Model requested unsupported tool',
    detail: `The selected model requested ${functionCall.name}, but that tool is not available in this route.`,
    query: undefined,
    sourceType: undefined,
    scope: 'unsupported tool',
  };
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

function selectRetrievalHitsByType(
  hitGroups: RetrievalHit[][],
  contentType: 'pdf' | 'video',
  limit = 3
) {
  return mergeRetrievalHits(hitGroups, Number.MAX_SAFE_INTEGER)
    .filter((hit) => hit.contentType === contentType)
    .slice(0, limit);
}

async function fetchRetrievalHits(authHeader: string, target: RetrievalTarget) {
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
}

async function searchAllClassPdfs(
  request: NextRequest,
  authHeader: string,
  classId: string,
  query: string
) {
  return fetchRetrievalHits(authHeader, {
    url: new URL(`/api/retrieval/class/${classId}/pdf`, request.nextUrl.origin),
    body: {
      query,
      limit: 8,
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { recordingId } = await params;
    const classId = typeof body.classId === 'string' ? body.classId.trim() : '';
    const recordingTitle =
      typeof body.sourceTitle === 'string'
        ? body.sourceTitle.trim()
        : typeof body.bookTitle === 'string'
          ? body.bookTitle.trim()
          : 'Current recording';
    const messages = normalizeMessages(body.messages);
    const resourceScopes = normalizeResourceScopes(body.resourceScopes);
    const includeWebData = normalizeUseExternalSources(body, resourceScopes);
    const defaultModel = normalizeAskAiModel(
      process.env.ASK_AI_CHAT_MODEL || process.env.GEMINI_CHAT_MODEL,
      DEFAULT_ASK_AI_MODEL
    );
    const selectedModel = normalizeAskAiModel(body.model, defaultModel);

    if (!classId) {
      return NextResponse.json({ error: 'Missing required field: classId' }, { status: 400 });
    }

    const latestUserMessage = messages[messages.length - 1];
    const steps: AskAiStep[] = [];
    const [classPdfHits, currentRecordingHits, classVideoHits, webResults] = await Promise.all([
      fetchRetrievalHits(authHeader, {
        url: new URL(`/api/retrieval/class/${classId}/pdf`, request.nextUrl.origin),
        body: {
          query: latestUserMessage.content,
          limit: 6,
        },
      }),
      fetchRetrievalHits(authHeader, {
        url: new URL(`/api/retrieval/class/${classId}/video`, request.nextUrl.origin),
        body: {
          query: latestUserMessage.content,
          sourceIds: [recordingId],
          limit: 6,
        },
      }),
      fetchRetrievalHits(authHeader, {
        url: new URL(`/api/retrieval/class/${classId}/video`, request.nextUrl.origin),
        body: {
          query: latestUserMessage.content,
          limit: 6,
        },
      }),
      includeWebData ? searchDuckDuckGoContext(latestUserMessage.content) : Promise.resolve([]),
    ]);

    const pdfContextHits = selectRetrievalHitsByType([classPdfHits], 'pdf', 3);
    const videoContextHits = selectRetrievalHitsByType([currentRecordingHits, classVideoHits], 'video', 3);
    const videoRawCount = mergeRetrievalHits([currentRecordingHits, classVideoHits], Number.MAX_SAFE_INTEGER).filter(
      (hit) => hit.contentType === 'video'
    ).length;

    steps.push(
      createStep(
        'retrieve-pdf-context',
        'retrieval',
        'Retrieved PDF context',
        `Searched all class PDFs from the video tab; using ${pdfContextHits.length} of ${classPdfHits.length} matching PDF result${classPdfHits.length === 1 ? '' : 's'}.`,
        {
          query: latestUserMessage.content,
          count: pdfContextHits.length,
          sourceType: 'pdf',
          scope: 'all class PDFs',
        }
      ),
      createStep(
        'retrieve-video-context',
        'retrieval',
        'Retrieved video context',
        `Searched the current recording first, then indexed class recordings; using ${videoContextHits.length} of ${videoRawCount} deduped video result${videoRawCount === 1 ? '' : 's'}.`,
        {
          query: latestUserMessage.content,
          count: videoContextHits.length,
          sourceType: 'video',
          scope: 'current recording plus indexed class recordings',
        }
      ),
      createStep(
        'web-context',
        'web',
        includeWebData ? 'Checked external sources' : 'Skipped external sources',
        includeWebData
          ? `DuckDuckGo returned ${webResults.length} web result${webResults.length === 1 ? '' : 's'}.`
          : 'Use external sources is off, so no DuckDuckGo context was requested.',
        {
          query: includeWebData ? latestUserMessage.content : undefined,
          count: webResults.length,
          sourceType: 'web',
          scope: 'DuckDuckGo',
        }
      )
    );

    const hits = [...pdfContextHits, ...videoContextHits];
    const resourceScopeLabel = describeResourceScope(recordingTitle);

    const prompt = [
      'You are Smart Learn AI inside a video viewer.',
      buildAskAiGuardrailPrompt(resourceScopeLabel, { includeWebData, includeStructuralData: true }),
      'Use short paragraphs. Use flat bullets only if they make the answer clearer.',
      'Start from class PDF excerpts, current/indexed recording excerpts, and enabled web context.',
      'If that context is insufficient, call search_class_pdfs once with a rewritten retrieval query. Do not call it when the provided context already answers the question.',
      'If the student asks about class organization, sections/modules, uploaded books, recordings, processing statuses, upload dates, file sizes, or recording duration, call query_class_structure. Do not call it for conceptual questions already answered by the retrieved excerpts.',
      '',
      `Current recording title: ${recordingTitle}`,
      `Resource scope: ${resourceScopeLabel}`,
      `Web data: ${includeWebData ? 'Enabled by the student' : 'Disabled'}`,
      'Structural search: Available as an optional tool call',
      `Reasoning model: ${selectedModel}`,
      '',
      'Recent conversation:',
      summarizeConversation(messages),
      '',
      'Retrieved excerpts from class PDFs and current/indexed recordings:',
      hits.length > 0 ? buildContext(hits, recordingTitle) : 'No matching uploaded excerpts were found.',
      ...(includeWebData
        ? [
            '',
            'DuckDuckGo web context:',
            webResults.length > 0 ? formatWebSearchContext(webResults) : 'No DuckDuckGo web context was found.',
          ]
        : []),
      `Student's latest question: ${latestUserMessage.content}`,
    ].join('\n');

    const initialContents: AskAiContent[] = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];
    const toolDeclarations = [SEARCH_CLASS_PDFS_FUNCTION, QUERY_CLASS_STRUCTURE_FUNCTION];
    let contents = initialContents;
    let modelResponse = await callAskAiModel(contents, selectedModel, {
      tools: toolDeclarations,
    });
    let answer = modelResponse.text;
    let pdfToolHits: RetrievalHit[] = [];
    let structuralSources: AskAiSource[] = [];
    const calledTools = new Set<string>();
    let forcedPdfToolCall = false;

    if (!modelResponse.functionCall && shouldRepairBroadPdfToolDecision(answer, pdfContextHits)) {
      steps.push(
        createStep(
          'broad-pdf-tool-decision-repair',
          'decision',
          'Rechecked broader PDF need',
          `The first model pass did not call the PDF search tool after ${pdfContextHits.length} class PDF result${pdfContextHits.length === 1 ? '' : 's'}, so Ask AI requested an explicit rephrased PDF search decision before finalizing.`,
          {
            count: pdfContextHits.length,
            sourceType: 'pdf',
            scope: 'all class PDFs',
          }
        )
      );

      contents = [
        ...contents,
        modelResponse.content || {
          role: 'model',
          parts: [{ text: answer }],
        },
        {
          role: 'user',
          parts: [
            {
              text: [
                'Before finalizing, make an explicit PDF retrieval decision.',
                `The initial class PDF search returned ${pdfContextHits.length} usable PDF excerpt${pdfContextHits.length === 1 ? '' : 's'}.`,
                'If those PDF excerpts do not directly support the student question, call search_class_pdfs now with a rewritten semantic retrieval query over all class PDFs.',
                'If the existing PDF, video, structural, or web context already directly supports the answer, answer normally without calling a tool.',
                `Student question: ${latestUserMessage.content}`,
              ].join('\n'),
            },
          ],
        },
      ];

      modelResponse = await callAskAiModel(contents, selectedModel, {
        tools: toolDeclarations,
      });
      answer = modelResponse.text;
    }

    if (!modelResponse.functionCall && shouldForceBroadPdfToolFallback(answer, pdfContextHits)) {
      forcedPdfToolCall = true;
      modelResponse = {
        text: '',
        functionCall: {
          name: 'search_class_pdfs',
          args: {
            query: latestUserMessage.content,
          },
        },
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'search_class_pdfs',
                args: {
                  query: latestUserMessage.content,
                },
              },
            },
          ],
        },
      };
    }

    while (modelResponse.functionCall && calledTools.size < 2) {
      const functionCall = modelResponse.functionCall;
      if (calledTools.has(functionCall.name)) break;
      calledTools.add(functionCall.name);
      const wasForcedPdfToolCall = forcedPdfToolCall && functionCall.name === 'search_class_pdfs';
      forcedPdfToolCall = false;

      let functionResult = '';

      if (functionCall.name === 'search_class_pdfs') {
        const toolDecision = describeToolDecision(functionCall, latestUserMessage.content, modelResponse.text);
        if (!wasForcedPdfToolCall) {
          steps.push(
            createStep(
              `model-requested-${functionCall.name}-${calledTools.size}`,
              'decision',
              toolDecision.title,
              toolDecision.detail,
              {
                query: toolDecision.query,
                sourceType: toolDecision.sourceType,
                scope: toolDecision.scope,
              }
            )
          );
        }

        const toolQuery = getFunctionCallQuery(functionCall, latestUserMessage.content);
        const rawPdfToolHits = await searchAllClassPdfs(request, authHeader, classId, toolQuery);
        pdfToolHits = selectRetrievalHitsByType([rawPdfToolHits], 'pdf', 3);
        steps.push(
          createStep(
            'search-class-pdfs-tool',
            'tool',
            'Called PDF search tool',
            wasForcedPdfToolCall
              ? `Ask AI triggered broader class PDF search because the initial context was empty or unsupported; using ${pdfToolHits.length} of ${rawPdfToolHits.length} matching result${rawPdfToolHits.length === 1 ? '' : 's'}.`
              : `The selected model requested broader class PDF context; using ${pdfToolHits.length} of ${rawPdfToolHits.length} matching result${rawPdfToolHits.length === 1 ? '' : 's'}.`,
            {
              query: toolQuery,
              count: pdfToolHits.length,
              sourceType: 'pdf',
              scope: 'all class PDFs',
            }
          )
        );
        const toolContext = pdfToolHits.length > 0
          ? buildContext(pdfToolHits, recordingTitle)
          : 'No matching PDF passages were found in the class.';
        functionResult = [`Retrieval query: ${toolQuery}`, '', toolContext].join('\n');
        steps.push(
          createStep(
            `returned-${functionCall.name}-result-${calledTools.size}`,
            'tool',
            'Returned PDF search results',
            `Ask AI added ${pdfToolHits.length} broader PDF excerpt${pdfToolHits.length === 1 ? '' : 's'} back into the model conversation for the next reasoning pass.`,
            {
              query: toolQuery,
              count: pdfToolHits.length,
              sourceType: 'pdf',
              scope: 'all class PDFs',
            }
          )
        );
      } else if (functionCall.name === 'query_class_structure') {
        const toolDecision = describeToolDecision(functionCall, latestUserMessage.content, modelResponse.text);
        steps.push(
          createStep(
            `model-requested-${functionCall.name}-${calledTools.size}`,
            'decision',
            toolDecision.title,
            toolDecision.detail,
            {
              sourceType: toolDecision.sourceType,
              scope: toolDecision.scope,
            }
          )
        );
        const structuralResult = await buildClassStructuralContext(authHeader.slice('Bearer '.length).trim(), classId);
        structuralSources = structuralResult.sources;
        functionResult = structuralResult.context || 'No class structure data was found.';
        steps.push(
          createStep(
            'query-class-structure-tool',
            'tool',
            'Queried class structure',
            structuralResult.detail,
            {
              count: structuralResult.sources.length,
              sourceType: 'structural',
              scope: 'Supabase class database',
            }
          )
        );
        steps.push(
          createStep(
            `returned-${functionCall.name}-result-${calledTools.size}`,
            'tool',
            'Returned class structure results',
            `Ask AI added ${structuralResult.sources.length} structural source summary back into the model conversation for the next reasoning pass.`,
            {
              count: structuralResult.sources.length,
              sourceType: 'structural',
              scope: 'Supabase class database',
            }
          )
        );
      } else {
        const toolDecision = describeToolDecision(functionCall, latestUserMessage.content, modelResponse.text);
        steps.push(
          createStep(
            `model-requested-${functionCall.name}-${calledTools.size}`,
            'decision',
            toolDecision.title,
            toolDecision.detail,
            {
              scope: toolDecision.scope,
            }
          )
        );
        break;
      }

      contents = [
        ...contents,
        modelResponse.content || {
          role: 'model',
          parts: [{ functionCall: functionCall as AskAiFunctionCall }],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                ...(functionCall.id ? { id: functionCall.id } : {}),
                name: functionCall.name,
                response: {
                  result: functionResult,
                },
              },
            },
          ],
        },
      ];

      modelResponse = await callAskAiModel(contents, selectedModel, {
        tools: toolDeclarations,
      });
      answer = modelResponse.text;
    }

    if (!answer && modelResponse.functionCall) {
      const finalModelResponse = await callAskAiModel(
        [
          ...contents,
          {
            role: 'user',
            parts: [
              {
                text: 'No additional tool calls are available. Generate the final answer using only the retrieved context and any tool results already provided.',
              },
            ],
          },
        ],
        selectedModel
      );
      answer = finalModelResponse.text;
    }

    if (calledTools.size > 0) {
      steps.push(
        createStep(
          'final-answer-after-tool',
          'generation',
          'Generated final answer',
          `The selected model generated the answer after receiving ${calledTools.size} optional tool result${calledTools.size === 1 ? '' : 's'}.`,
          {
            count: mergeRetrievalHits([hits, pdfToolHits], 10).length,
            scope: 'balanced context plus tool results',
          }
        )
      );
    } else {
      steps.push(
        createStep(
          'final-answer',
          'generation',
          'Generated final answer',
          'The selected model answered from the retrieved PDF/video context and enabled web context without optional tool calls.',
          {
            count: hits.length,
            scope: 'balanced initial context',
          }
        )
      );
    }

    if (!answer) {
      throw new Error('The selected model returned an empty response');
    }

    return NextResponse.json({
      answer,
      sources: buildSources(
        mergeRetrievalHits([hits, pdfToolHits], 10),
        includeWebData ? webResults : [],
        structuralSources
      ),
      steps,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to answer this question');
    console.error('Recording Ask AI error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
