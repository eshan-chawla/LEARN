'use client';

import {
  ASK_AI_GEMINI_MODELS,
  DEFAULT_ASK_AI_GEMINI_MODEL,
  getAskAiGeminiModelLabel,
  normalizeAskAiGeminiModel,
  type AskAiGeminiModel,
} from '@/lib/ask-ai/models';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';

type ChatRole = 'user' | 'assistant';
type AskAiResourceScope = 'currentBook' | 'entireModule' | 'allBooks' | 'includeVideos' | 'includeWebData';
type CitationTab = 'pdf' | 'video' | 'web';

interface ChatSource {
  pageNumber: number | null;
  excerpt: string;
  score: number;
  sourceId: string;
  contentType: 'pdf' | 'video' | 'web';
  title: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  url?: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
}

interface ResourceScopeState {
  entireModule: boolean;
  allBooks: boolean;
  includeVideos: boolean;
  includeWebData: boolean;
}

interface PdfSourceMeta {
  title: string;
  moduleTitle: string | null;
}

interface BookAskAIPanelProps {
  bookId: string;
  classId: string;
  classSlug: string;
  bookTitle: string;
  moduleBookIds: string[];
  pdfSourceMeta: Record<string, PdfSourceMeta>;
  hasModuleScope: boolean;
  sourceKind?: 'pdf' | 'video';
  askAiPath?: string;
  open: boolean;
  desktopWidth: number;
  resizing: boolean;
  onClose: () => void;
  onJumpToPage?: (pageNumber: number) => void;
  onJumpToTimestamp?: (seconds: number) => void;
  onResizeStart: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

function createMessage(role: ChatRole, content: string, sources?: ChatSource[]): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    sources,
  };
}

function isLegacyWelcomeMessage(message: ChatMessage) {
  return (
    message.role === 'assistant' &&
    /^Ask about .+\. I will answer from the selected resources and point you to relevant sources when I can\.$/.test(
      message.content
    )
  );
}

function formatSimilarityScore(score: number): string {
  return Number.isFinite(score) ? `${Math.round(score * 100)}%` : 'N/A';
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

function getDefaultCitationTab(sources: ChatSource[]): CitationTab {
  if (sources.some((source) => source.contentType === 'pdf')) return 'pdf';
  if (sources.some((source) => source.contentType === 'video')) return 'video';
  return 'web';
}

function getScopeSummary(
  hasModuleScope: boolean,
  resourceScopes: Record<Exclude<AskAiResourceScope, 'currentBook'>, boolean>,
  sourceKind: 'pdf' | 'video'
) {
  const currentSourceLabel = sourceKind === 'video' ? 'Current video' : 'Current book';
  const webSuffix = resourceScopes.includeWebData ? ' + web' : '';

  if (resourceScopes.allBooks && resourceScopes.includeVideos) {
    return `${currentSourceLabel} + all books + videos${webSuffix}`;
  }

  if (resourceScopes.allBooks) return `${currentSourceLabel} + all books${webSuffix}`;
  if (resourceScopes.entireModule && resourceScopes.includeVideos && hasModuleScope) {
    return `${currentSourceLabel} + module + videos${webSuffix}`;
  }
  if (resourceScopes.includeVideos) return `${currentSourceLabel} + videos${webSuffix}`;
  if (resourceScopes.entireModule && hasModuleScope) return `${currentSourceLabel} + module${webSuffix}`;
  return `${currentSourceLabel}${webSuffix}`;
}

function normalizeResourceScopeState(value: unknown): ResourceScopeState {
  if (!value || typeof value !== 'object') {
    return {
      entireModule: false,
      allBooks: false,
      includeVideos: false,
      includeWebData: false,
    };
  }

  return {
    entireModule: Boolean((value as { entireModule?: unknown }).entireModule),
    allBooks: Boolean(
      (value as { allBooks?: unknown; entireClassModules?: unknown }).allBooks ??
        (value as { allBooks?: unknown; entireClassModules?: unknown }).entireClassModules
    ),
    includeVideos: Boolean(
      (value as { includeVideos?: unknown; entireClassContent?: unknown }).includeVideos ??
        (value as { includeVideos?: unknown; entireClassContent?: unknown }).entireClassContent
    ),
    includeWebData: Boolean((value as { includeWebData?: unknown; webData?: unknown }).includeWebData ??
      (value as { includeWebData?: unknown; webData?: unknown }).webData),
  };
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((message): ChatMessage | null => {
      if (!message || typeof message !== 'object') return null;

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;
      const rawSources = (message as { sources?: unknown }).sources;

      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) {
        return null;
      }

      const sources = Array.isArray(rawSources)
        ? rawSources
            .map((source) => {
              if (!source || typeof source !== 'object') return null;

              const contentType =
                (source as { contentType?: unknown }).contentType === 'web'
                  ? 'web'
                  : (source as { contentType?: unknown }).contentType === 'video'
                    ? 'video'
                    : 'pdf';

              const nextSource: ChatSource = {
                pageNumber: typeof (source as { pageNumber?: unknown }).pageNumber === 'number'
                  ? (source as { pageNumber: number }).pageNumber
                  : null,
                excerpt: typeof (source as { excerpt?: unknown }).excerpt === 'string'
                  ? (source as { excerpt: string }).excerpt
                  : '',
                score: typeof (source as { score?: unknown }).score === 'number'
                  ? (source as { score: number }).score
                  : 0,
                sourceId: typeof (source as { sourceId?: unknown }).sourceId === 'string'
                  ? (source as { sourceId: string }).sourceId
                  : '',
                contentType,
                title: typeof (source as { title?: unknown }).title === 'string'
                  ? (source as { title: string }).title
                  : null,
                startSeconds: typeof (source as { startSeconds?: unknown }).startSeconds === 'number'
                  ? (source as { startSeconds: number }).startSeconds
                  : null,
                endSeconds: typeof (source as { endSeconds?: unknown }).endSeconds === 'number'
                  ? (source as { endSeconds: number }).endSeconds
                  : null,
              };

              if (typeof (source as { url?: unknown }).url === 'string') {
                nextSource.url = (source as { url: string }).url;
              }

              return nextSource;
            })
            .filter((source): source is ChatSource => source !== null)
        : undefined;

      const nextMessage: ChatMessage = {
        id: typeof (message as { id?: unknown }).id === 'string'
          ? (message as { id: string }).id
          : `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
      };

      if (sources) {
        nextMessage.sources = sources;
      }

      return nextMessage;
    })
    .filter((message): message is ChatMessage => message !== null)
    .filter((message) => !isLegacyWelcomeMessage(message));

  return normalized;
}

export function BookAskAIPanel({
  bookId,
  classId,
  classSlug,
  bookTitle,
  moduleBookIds,
  pdfSourceMeta,
  hasModuleScope,
  sourceKind = 'pdf',
  askAiPath,
  open,
  desktopWidth,
  resizing,
  onClose,
  onJumpToPage,
  onJumpToTimestamp,
  onResizeStart,
}: BookAskAIPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [citationTabs, setCitationTabs] = useState<Record<string, CitationTab>>({});
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AskAiGeminiModel>(DEFAULT_ASK_AI_GEMINI_MODEL);
  const [resourceScopes, setResourceScopes] = useState<ResourceScopeState>({
    entireModule: false,
    allBooks: false,
    includeVideos: false,
    includeWebData: false,
  });
  const [historyReady, setHistoryReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resourceMenuRef = useRef<HTMLDivElement | null>(null);
  const storageKey = `smart-learn-book-ask-ai-session:${classSlug}`;

  const selectedScopeSummary = getScopeSummary(hasModuleScope, resourceScopes, sourceKind);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setExpandedSources({});
    setCitationTabs({});
    setError(null);
    setResourceMenuOpen(false);

    const storedValue = window.sessionStorage.getItem(storageKey);

    if (!storedValue) {
      setMessages([]);
      setInput('');
      setSelectedModel(DEFAULT_ASK_AI_GEMINI_MODEL);
      setResourceScopes({
        entireModule: false,
        allBooks: false,
        includeVideos: false,
        includeWebData: false,
      });
      setHistoryReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as {
        messages?: unknown;
        input?: unknown;
        resourceScopes?: unknown;
        selectedModel?: unknown;
        model?: unknown;
      };

      setMessages(normalizeMessages(parsed.messages));
      setInput(typeof parsed.input === 'string' ? parsed.input : '');
      setResourceScopes(normalizeResourceScopeState(parsed.resourceScopes));
      setSelectedModel(normalizeAskAiGeminiModel(parsed.selectedModel ?? parsed.model));
    } catch {
      setMessages([]);
      setInput('');
      setSelectedModel(DEFAULT_ASK_AI_GEMINI_MODEL);
      setResourceScopes({
        entireModule: false,
        allBooks: false,
        includeVideos: false,
        includeWebData: false,
      });
    } finally {
      setHistoryReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!historyReady || typeof window === 'undefined') return;

    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        messages,
        input,
        resourceScopes,
        selectedModel,
      })
    );
  }, [historyReady, input, messages, resourceScopes, selectedModel, storageKey]);

  useEffect(() => {
    if (!historyReady) return;

    setResourceScopes((current) => {
      if (hasModuleScope || !current.entireModule) {
        return current;
      }

      return {
        ...current,
        entireModule: false,
      };
    });
  }, [hasModuleScope, historyReady]);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!resourceMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (resourceMenuRef.current?.contains(event.target as Node)) return;
      setResourceMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setResourceMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [resourceMenuOpen]);

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || sending) return;

    const userMessage = createMessage('user', question);
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('No authentication token');
      }

      const endpoint = askAiPath || `/api/books/${bookId}/ask-ai`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          classId,
          bookTitle,
          model: selectedModel,
          moduleBookIds,
          resourceScopes: [
            'currentBook',
            ...(hasModuleScope && resourceScopes.entireModule ? (['entireModule'] as const) : []),
            ...(resourceScopes.allBooks ? (['allBooks'] as const) : []),
            ...(resourceScopes.includeVideos ? (['includeVideos'] as const) : []),
            ...(resourceScopes.includeWebData ? (['includeWebData'] as const) : []),
          ],
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      const payload = await response.json().catch(() => null) as
        | { answer?: string; sources?: ChatSource[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to ask AI');
      }

      const assistantMessage = createMessage(
        'assistant',
        payload?.answer || 'I could not generate an answer.',
        payload?.sources
      );

      setMessages((current) => [...current, assistantMessage]);
      if (assistantMessage.sources?.length) {
        setExpandedSources((current) => ({
          ...current,
          [assistantMessage.id]: false,
        }));
        setCitationTabs((current) => ({
          ...current,
          [assistantMessage.id]: getDefaultCitationTab(assistantMessage.sources || []),
        }));
      }
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to ask AI';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  const panelStyle = {
    '--ask-ai-width': `${desktopWidth}px`,
  } as CSSProperties;

  const handleModelChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(normalizeAskAiGeminiModel(event.target.value));
  };

  const getPdfSourceLabel = (source: ChatSource) => {
    const metadata = pdfSourceMeta[source.sourceId];
    const sourceTitle = metadata?.title || source.title || 'Book source';

    if (metadata?.moduleTitle) {
      return `${metadata.moduleTitle} · ${sourceTitle}`;
    }

    return sourceTitle;
  };

  const handleSourceClick = (source: ChatSource) => {
    if (source.contentType === 'web') {
      const url = source.url || source.sourceId;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (source.contentType === 'video') {
      if (sourceKind === 'video' && source.sourceId === bookId && source.startSeconds !== null && onJumpToTimestamp) {
        onJumpToTimestamp(source.startSeconds);
        return;
      }

      const nextParams = new URLSearchParams();
      if (source.startSeconds !== null) {
        nextParams.set('t', String(Math.floor(source.startSeconds)));
      }

      const queryString = nextParams.toString();
      router.push(
        queryString
          ? `/dashboard/class/${classSlug}/video/${source.sourceId}?${queryString}`
          : `/dashboard/class/${classSlug}/video/${source.sourceId}`
      );
      return;
    }

    if (source.sourceId === bookId) {
      if (sourceKind === 'pdf' && source.pageNumber && onJumpToPage) {
        onJumpToPage(source.pageNumber);
      }
      return;
    }

    const nextParams = new URLSearchParams();
    nextParams.set('ask-ai', 'open');

    if (source.pageNumber) {
      nextParams.set('page', String(source.pageNumber));
    }

    router.push(`/dashboard/class/${classSlug}/book/${source.sourceId}?${nextParams.toString()}`);
  };

  return (
    <aside
      style={panelStyle}
      className={`absolute inset-y-0 right-0 z-20 flex w-[24rem] flex-col overflow-hidden bg-[rgba(250,247,242,0.98)] ${resizing ? 'transition-[transform,opacity,box-shadow,border-color] duration-75' : 'transition-[transform,width,opacity,box-shadow,border-color] duration-300'} md:relative md:inset-y-auto md:right-auto md:z-0 md:flex-shrink-0 md:translate-x-0 ${open ? 'pointer-events-auto translate-x-0 border-l border-stone-200/80 opacity-100 shadow-[-24px_24px_60px_rgba(28,25,23,0.12)] md:w-[var(--ask-ai-width)] md:shadow-none' : 'pointer-events-none translate-x-full border-l border-transparent opacity-100 md:w-0 md:translate-x-0 md:border-l-0 md:opacity-0 md:shadow-none'}`}
      aria-hidden={!open}
    >
      {open && (
        <button
          type="button"
          onMouseDown={onResizeStart}
          className="absolute inset-y-0 left-0 hidden w-4 cursor-col-resize items-center justify-center md:flex"
          aria-label="Resize Ask AI panel"
          title="Drag to resize"
        >
          <span className={`h-16 w-px rounded-full transition-colors ${resizing ? 'bg-sky-500' : 'bg-stone-300'}`} />
        </button>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-stone-200/80 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Ask AI</p>
          <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-start gap-2 max-[420px]:grid-cols-1">
            <div ref={resourceMenuRef} className={`relative min-w-0 ${resourceMenuOpen ? 'z-50' : 'z-10'}`}>
              <button
                type="button"
                onClick={() => setResourceMenuOpen((current) => !current)}
                className="flex h-full min-h-[4.05rem] w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white/85 px-3 py-2.5 text-left transition hover:border-stone-300 hover:bg-white"
                aria-haspopup="menu"
                aria-expanded={resourceMenuOpen}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">Resources</p>
                  <p className="mt-1 truncate text-sm text-stone-600">{selectedScopeSummary}</p>
                </div>
                <svg
                  className={`h-4 w-4 flex-shrink-0 text-stone-500 transition-transform ${resourceMenuOpen ? 'rotate-180' : 'rotate-0'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {resourceMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-[24px] border border-stone-200 bg-[rgba(255,253,249,0.98)] p-2 shadow-[0_24px_60px_rgba(28,25,23,0.16)]">
                  <div className="space-y-1">
                    {([
                      {
                        key: 'entireModule',
                        label: 'Include Entire Module',
                        disabled: !hasModuleScope,
                      },
                      {
                        key: 'allBooks',
                        label: 'Include All Books',
                        disabled: false,
                      },
                      {
                        key: 'includeVideos',
                        label: 'Include Videos',
                        disabled: false,
                      },
                      {
                        key: 'includeWebData',
                        label: 'Include Web Data',
                        disabled: false,
                      },
                    ] as const).map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => {
                          if (option.disabled) return;
                          setResourceScopes((current) => {
                            const nextValue = !current[option.key];

                            if (option.key === 'entireModule') {
                              return {
                                ...current,
                                entireModule: nextValue,
                                allBooks: hasModuleScope && !nextValue ? false : current.allBooks,
                              };
                            }

                            if (option.key === 'allBooks') {
                              return {
                                ...current,
                                allBooks: nextValue,
                                entireModule:
                                  nextValue && hasModuleScope ? true : current.entireModule,
                              };
                            }

                            return {
                              ...current,
                              [option.key]: nextValue,
                            };
                          });
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-stone-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-stone-800">{option.label}</p>
                        </div>
                        <span
                          className={`ml-auto inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border px-0.5 transition ${
                            resourceScopes[option.key]
                              ? 'border-stone-900 bg-stone-900'
                              : 'border-stone-300 bg-white'
                          }`}
                          aria-hidden="true"
                        >
                          <span
                            className={`h-4 w-4 rounded-full bg-white shadow-[0_2px_6px_rgba(28,25,23,0.16)] transition-transform ${
                              resourceScopes[option.key] ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <label className="relative z-0 block min-w-0 rounded-2xl border border-stone-200 bg-white/85 px-3 py-2.5 transition hover:border-stone-300 hover:bg-white focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                Model
              </span>
              <select
                value={selectedModel}
                onChange={handleModelChange}
                className="mt-1 w-full appearance-none bg-transparent pr-6 text-sm text-stone-600 outline-none"
                title={`Gemini model: ${getAskAiGeminiModelLabel(selectedModel)}`}
              >
                {ASK_AI_GEMINI_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-stone-500">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200 bg-white/80 text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
          aria-label="Close Ask AI panel"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {messages.map((message) => {
            const messageSources = message.sources || [];
            const pdfSources = messageSources.filter((source) => source.contentType === 'pdf');
            const videoSources = messageSources.filter((source) => source.contentType === 'video');
            const webSources = messageSources.filter((source) => source.contentType === 'web');
            const citationOptions = [
              { key: 'pdf' as const, count: pdfSources.length, label: 'Book citations' },
              { key: 'video' as const, count: videoSources.length, label: 'Video citations' },
              { key: 'web' as const, count: webSources.length, label: 'Web sources' },
            ].filter((option) => option.count > 0);
            const showCitationTabs = citationOptions.length > 1;
            const preferredCitationTab = citationTabs[message.id];
            const activeCitationTab = showCitationTabs
              ? citationOptions.some((option) => option.key === preferredCitationTab)
                ? preferredCitationTab
                : citationOptions[0]?.key ?? 'pdf'
              : null;
            const visibleSources =
              activeCitationTab === 'pdf'
                ? pdfSources
                : activeCitationTab === 'video'
                  ? videoSources
                  : activeCitationTab === 'web'
                    ? webSources
                  : messageSources;

            return (
              <div
                key={message.id}
                className={`rounded-[24px] px-4 py-3 ${message.role === 'user' ? 'ml-6 bg-stone-900 text-stone-50 shadow-[0_16px_30px_rgba(28,25,23,0.2)]' : 'mr-4 border border-stone-200 bg-white/85 text-stone-800 shadow-[0_12px_30px_rgba(28,25,23,0.06)]'}`}
              >
                <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${message.role === 'user' ? 'text-stone-300' : 'text-stone-500'}`}>
                  {message.role === 'user' ? 'You' : 'Smart Learn AI'}
                </p>
                <div className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${message.role === 'user' ? 'text-stone-50' : 'text-stone-700'}`}>
                  {message.content}
                </div>

                {messageSources.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-start gap-2">
                      {showCitationTabs ? (
                        <>
                          {citationOptions.map((citationType) => {
                            const isActive = activeCitationTab === citationType.key && (expandedSources[message.id] ?? false);

                            return (
                              <button
                                key={citationType.key}
                                type="button"
                                disabled={citationType.count === 0}
                                aria-pressed={isActive}
                                aria-label={`${citationType.label} (${citationType.count})`}
                                title={`${citationType.label} (${citationType.count})`}
                                onClick={() => {
                                  if (citationType.count === 0) return;

                                  setCitationTabs((current) => ({
                                    ...current,
                                    [message.id]: citationType.key,
                                  }));

                                  setExpandedSources((current) => {
                                    const isCurrentlyActive =
                                      current[message.id] &&
                                      activeCitationTab === citationType.key;

                                    return {
                                      ...current,
                                      [message.id]: !isCurrentlyActive,
                                    };
                                  });
                                }}
                                className={`group inline-flex items-center gap-2 rounded-2xl border px-2.5 py-1.5 transition ${
                                  isActive
                                    ? 'border-stone-900 bg-stone-900 text-stone-50'
                                    : 'border-stone-200 bg-stone-50/80 text-stone-500 hover:border-stone-300 hover:bg-white hover:text-stone-700 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100/80 disabled:text-stone-300'
                                }`}
                              >
                                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-xl border transition ${
                                  isActive
                                    ? 'border-stone-700 bg-stone-800 text-stone-50'
                                    : 'border-stone-200 bg-white text-stone-500 group-hover:border-stone-300 group-hover:text-stone-700'
                                }`}>
                                  {citationType.key === 'pdf' ? (
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.8}
                                        d="M14 3.75H7.5A1.75 1.75 0 0 0 5.75 5.5v13A1.75 1.75 0 0 0 7.5 20.25h9A1.75 1.75 0 0 0 18.25 18.5V8L14 3.75Z"
                                      />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 3.75V8h4.25" />
                                    </svg>
                                  ) : citationType.key === 'video' ? (
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.8}
                                        d="M4.75 8A1.75 1.75 0 0 1 6.5 6.25h7A1.75 1.75 0 0 1 15.25 8v8A1.75 1.75 0 0 1 13.5 17.75h-7A1.75 1.75 0 0 1 4.75 16V8Z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.8}
                                        d="m15.25 10 4-2.25v8.5l-4-2.25V10Z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.8}
                                        d="m10.25 10.25-2.75 1.75 2.75 1.75v-3.5Z"
                                      />
                                    </svg>
                                  ) : (
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.8}
                                        d="M12 20.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z"
                                      />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 12h16.5M12 3.75c2.1 2.25 3.15 5 3.15 8.25S14.1 18 12 20.25C9.9 18 8.85 15.25 8.85 12S9.9 6 12 3.75Z" />
                                    </svg>
                                  )}
                                </span>
                                <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  isActive
                                    ? 'bg-stone-700 text-stone-100'
                                    : 'bg-stone-200/80 text-stone-500'
                                }`}>
                                  {citationType.count}
                                </span>
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedSources((current) => ({
                              ...current,
                              [message.id]: !(current[message.id] ?? false),
                            }));
                          }}
                          aria-expanded={expandedSources[message.id] ?? false}
                          aria-label={`Show ${messageSources.length} source${messageSources.length === 1 ? '' : 's'}`}
                          title={`${messageSources.length} source${messageSources.length === 1 ? '' : 's'}`}
                          className="group inline-flex items-center gap-1.5 rounded-2xl border border-stone-200 bg-stone-50/80 px-2 py-1.5 text-stone-500 transition hover:border-stone-300 hover:bg-white hover:text-stone-700"
                        >
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 transition group-hover:border-stone-300 group-hover:text-stone-700">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.8}
                                d="M14 3.75H7.5A1.75 1.75 0 0 0 5.75 5.5v13A1.75 1.75 0 0 0 7.5 20.25h9A1.75 1.75 0 0 0 18.25 18.5V8L14 3.75Z"
                              />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 3.75V8h4.25" />
                            </svg>
                          </span>
                          <span className="text-[10px] font-semibold tabular-nums text-stone-500 group-hover:text-stone-700">
                            {messageSources.length}
                          </span>
                        </button>
                      )}
                    </div>

                    <div className={`grid transition-[grid-template-rows] duration-300 ${(expandedSources[message.id] ?? false) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden">
                        <div className="space-y-2 pt-1">
                          {visibleSources.map((source, index) => {
                            const canInteractWithSource =
                              source.contentType === 'web'
                                ? Boolean(source.url || source.sourceId)
                                : source.contentType === 'video'
                                ? true
                                : source.contentType === 'pdf' &&
                                  (source.sourceId !== bookId || source.pageNumber !== null);
                            const videoTimeRange =
                              source.contentType === 'video'
                                ? [formatTimecode(source.startSeconds), formatTimecode(source.endSeconds)]
                                    .filter(Boolean)
                                    .join(' - ')
                                : null;

                            return (
                              <div key={`${message.id}-${source.contentType}-${source.sourceId}-${index}`} className="group relative">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (canInteractWithSource) {
                                      handleSourceClick(source);
                                    }
                                  }}
                                  className="w-full rounded-2xl border border-stone-200 bg-stone-50/80 px-3 py-3 text-left transition hover:border-stone-300 hover:bg-white disabled:cursor-default"
                                  disabled={!canInteractWithSource}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                                        {source.contentType === 'web'
                                          ? 'Web source'
                                          : source.contentType === 'video'
                                          ? videoTimeRange || 'Transcript excerpt'
                                          : source.pageNumber
                                          ? `Page ${source.pageNumber}`
                                          : 'Page unavailable'}
                                      </span>
                                      <span className="block truncate text-sm font-medium text-stone-700">
                                        {source.contentType === 'pdf'
                                          ? getPdfSourceLabel(source)
                                          : source.contentType === 'web'
                                            ? source.title || 'DuckDuckGo result'
                                            : source.title || 'Class recording'}
                                      </span>
                                      <span className="block text-[11px] font-medium text-stone-400">
                                        {source.contentType === 'web'
                                          ? source.sourceId.replace(/^https?:\/\//, '').replace(/^www\./, '')
                                          : `Similarity ${formatSimilarityScore(source.score)}`}
                                      </span>
                                    </div>
                                    <span className="pt-0.5 text-xs font-medium text-stone-400">
                                      {source.contentType === 'web'
                                        ? 'Open web'
                                        : source.contentType === 'video'
                                        ? 'Open source'
                                        : source.contentType !== 'pdf'
                                          ? 'Preview only'
                                        : source.sourceId !== bookId
                                          ? 'Open source'
                                          : source.pageNumber
                                            ? 'Jump to page'
                                            : 'Preview only'}
                                    </span>
                                  </div>
                                </button>

                                <div className="pointer-events-none absolute left-3 right-3 top-full z-20 mt-2 hidden rounded-[20px] border border-stone-200 bg-[rgba(255,253,249,0.98)] p-4 text-sm leading-6 text-stone-600 opacity-0 shadow-[0_24px_60px_rgba(28,25,23,0.14)] transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:block">
                                  {source.excerpt}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {sending && (
            <div className="mr-4 rounded-[24px] border border-stone-200 bg-white/85 px-4 py-3 text-sm text-stone-600 shadow-[0_12px_30px_rgba(28,25,23,0.06)]">
              Thinking with the selected resources{resourceScopes.includeWebData ? ' and web data' : ''}...
            </div>
          )}

          {!sending && messages.length === 0 && (
            <div className="rounded-[24px] border border-dashed border-stone-200 bg-white/65 px-4 py-5 text-sm leading-6 text-stone-500">
              Try asking for a definition, a summary of a concept, or where a topic is discussed in the selected resources.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-stone-200/80 px-4 py-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="space-y-3"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError(null);
            }}
            placeholder={`Ask about ${bookTitle}`}
            rows={4}
            className="w-full resize-none rounded-[22px] border border-stone-200 bg-white/90 px-4 py-3 text-sm leading-6 text-stone-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          />

          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-stone-500">
              {resourceScopes.includeWebData
                ? 'Answers may use selected uploaded materials plus DuckDuckGo web context.'
                : `Answers are grounded in retrieved passages from ${selectedScopeSummary.toLowerCase()}.`}
            </p>
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center justify-center rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 shadow-[0_12px_30px_rgba(28,25,23,0.2)] transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              Ask AI
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
