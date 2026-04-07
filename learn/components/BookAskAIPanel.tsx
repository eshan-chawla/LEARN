'use client';

import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

type ChatRole = 'user' | 'assistant';
type AskAiResourceScope = 'currentBook' | 'entireModule' | 'entireClassModules' | 'entireClassContent';

interface ChatSource {
  pageNumber: number | null;
  excerpt: string;
  score: number;
  sourceId: string;
  contentType: 'pdf' | 'video';
  title: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
}

interface ResourceScopeState {
  entireModule: boolean;
  entireClassModules: boolean;
  entireClassContent: boolean;
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
  open: boolean;
  desktopWidth: number;
  resizing: boolean;
  onClose: () => void;
  onJumpToPage: (pageNumber: number) => void;
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

function createWelcomeMessage(bookTitle: string) {
  return createMessage(
    'assistant',
    `Ask about ${bookTitle}. I will answer from the selected resources and point you to relevant sources when I can.`
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

function getScopeSummary(
  hasModuleScope: boolean,
  resourceScopes: Record<Exclude<AskAiResourceScope, 'currentBook'>, boolean>
) {
  if (resourceScopes.entireClassContent) return 'Current book + class content';
  if (resourceScopes.entireClassModules) return 'Current book + class modules';
  if (resourceScopes.entireModule && hasModuleScope) return 'Current book + module';
  return 'Current book';
}

function normalizeResourceScopeState(value: unknown): ResourceScopeState {
  if (!value || typeof value !== 'object') {
    return {
      entireModule: false,
      entireClassModules: false,
      entireClassContent: false,
    };
  }

  return {
    entireModule: Boolean((value as { entireModule?: unknown }).entireModule),
    entireClassModules: Boolean((value as { entireClassModules?: unknown }).entireClassModules),
    entireClassContent: Boolean((value as { entireClassContent?: unknown }).entireClassContent),
  };
}

function normalizeMessages(value: unknown, bookTitle: string): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [createWelcomeMessage(bookTitle)];
  }

  const normalized = value
    .map((message) => {
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
                (source as { contentType?: unknown }).contentType === 'video' ? 'video' : 'pdf';

              return {
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
              } satisfies ChatSource;
            })
            .filter((source): source is ChatSource => source !== null)
        : undefined;

      return {
        id: typeof (message as { id?: unknown }).id === 'string'
          ? (message as { id: string }).id
          : `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
        sources,
      } satisfies ChatMessage;
    })
    .filter((message): message is ChatMessage => message !== null);

  return normalized.length > 0 ? normalized : [createWelcomeMessage(bookTitle)];
}

export function BookAskAIPanel({
  bookId,
  classId,
  classSlug,
  bookTitle,
  moduleBookIds,
  pdfSourceMeta,
  hasModuleScope,
  open,
  desktopWidth,
  resizing,
  onClose,
  onJumpToPage,
  onResizeStart,
}: BookAskAIPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage(bookTitle)]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);
  const [resourceScopes, setResourceScopes] = useState<ResourceScopeState>({
    entireModule: false,
    entireClassModules: false,
    entireClassContent: false,
  });
  const [historyReady, setHistoryReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resourceMenuRef = useRef<HTMLDivElement | null>(null);
  const storageKey = `smart-learn-book-ask-ai-session:${classSlug}`;

  const selectedScopeSummary = getScopeSummary(hasModuleScope, resourceScopes);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setExpandedSources({});
    setError(null);
    setResourceMenuOpen(false);

    const storedValue = window.sessionStorage.getItem(storageKey);

    if (!storedValue) {
      setMessages([createWelcomeMessage(bookTitle)]);
      setInput('');
      setResourceScopes({
        entireModule: false,
        entireClassModules: false,
        entireClassContent: false,
      });
      setHistoryReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as {
        messages?: unknown;
        input?: unknown;
        resourceScopes?: unknown;
      };

      setMessages(normalizeMessages(parsed.messages, bookTitle));
      setInput(typeof parsed.input === 'string' ? parsed.input : '');
      setResourceScopes(normalizeResourceScopeState(parsed.resourceScopes));
    } catch {
      setMessages([createWelcomeMessage(bookTitle)]);
      setInput('');
      setResourceScopes({
        entireModule: false,
        entireClassModules: false,
        entireClassContent: false,
      });
    } finally {
      setHistoryReady(true);
    }
  }, [bookTitle, storageKey]);

  useEffect(() => {
    if (!historyReady || typeof window === 'undefined') return;

    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        messages,
        input,
        resourceScopes,
      })
    );
  }, [historyReady, input, messages, resourceScopes, storageKey]);

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

      const response = await fetch(`/api/books/${bookId}/ask-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          classId,
          bookTitle,
          moduleBookIds,
          resourceScopes: [
            'currentBook',
            ...(hasModuleScope && resourceScopes.entireModule ? (['entireModule'] as const) : []),
            ...(resourceScopes.entireClassModules ? (['entireClassModules'] as const) : []),
            ...(resourceScopes.entireClassContent ? (['entireClassContent'] as const) : []),
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

  const getPdfSourceLabel = (source: ChatSource) => {
    const metadata = pdfSourceMeta[source.sourceId];
    const sourceTitle = metadata?.title || source.title || 'Book source';

    if (metadata?.moduleTitle) {
      return `${metadata.moduleTitle} · ${sourceTitle}`;
    }

    return sourceTitle;
  };

  const handleSourceClick = (source: ChatSource) => {
    if (source.contentType === 'video') {
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
      if (source.pageNumber) {
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
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Ask AI</p>
          <div ref={resourceMenuRef} className="relative mt-2">
            <button
              type="button"
              onClick={() => setResourceMenuOpen((current) => !current)}
              className="flex min-w-[13.5rem] items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white/85 px-3 py-2.5 text-left transition hover:border-stone-300 hover:bg-white"
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
              <div className="absolute left-0 top-full z-30 mt-2 w-[18rem] rounded-[24px] border border-stone-200 bg-[rgba(255,253,249,0.98)] p-2 shadow-[0_24px_60px_rgba(28,25,23,0.16)]">
                <div className="space-y-1">
                  <div className="flex items-start gap-3 rounded-2xl px-3 py-2.5">
                    <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border border-stone-900 bg-stone-900 text-white">
                      <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800">Current book</p>
                      <p className="mt-0.5 text-xs leading-5 text-stone-500">Always included for the page you are reading.</p>
                    </div>
                  </div>

                  {([
                    {
                      key: 'entireModule',
                      label: 'Entire module',
                      description: hasModuleScope
                        ? 'Search across the other books in this module too.'
                        : 'Unavailable because this book is not inside a module.',
                      disabled: !hasModuleScope,
                    },
                    {
                      key: 'entireClassModules',
                      label: 'Entire class modules',
                      description: 'Search across the class book library.',
                      disabled: false,
                    },
                    {
                      key: 'entireClassContent',
                      label: 'Entire class content',
                      description: 'Search across books and any indexed class recordings.',
                      disabled: false,
                    },
                  ] as const).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      disabled={option.disabled}
                      onClick={() => {
                        if (option.disabled) return;
                        setResourceScopes((current) => ({
                          ...current,
                          [option.key]: !current[option.key],
                        }));
                      }}
                      className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-stone-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition ${
                          resourceScopes[option.key]
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-300 bg-white text-transparent'
                        }`}
                      >
                        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800">{option.label}</p>
                        <p className="mt-0.5 text-xs leading-5 text-stone-500">{option.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
          {messages.map((message) => (
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

              {message.sources && message.sources.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-start">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedSources((current) => ({
                          ...current,
                          [message.id]: !(current[message.id] ?? false),
                        }));
                      }}
                      aria-expanded={expandedSources[message.id] ?? false}
                      aria-label={`Show ${message.sources.length} source${message.sources.length === 1 ? '' : 's'}`}
                      title={`${message.sources.length} source${message.sources.length === 1 ? '' : 's'}`}
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
                        {message.sources.length}
                      </span>
                    </button>
                  </div>

                  <div className={`grid transition-[grid-template-rows] duration-300 ${(expandedSources[message.id] ?? false) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="space-y-2 pt-1">
                        {message.sources.map((source, index) => {
                          const canInteractWithSource =
                            source.contentType === 'video'
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
                            <div key={`${message.id}-${index}`} className="group relative">
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
                                      {source.contentType === 'video'
                                        ? videoTimeRange || 'Transcript excerpt'
                                        : source.pageNumber
                                        ? `Page ${source.pageNumber}`
                                        : 'Page unavailable'}
                                    </span>
                                    <span className="block truncate text-sm font-medium text-stone-700">
                                      {source.contentType === 'pdf'
                                        ? getPdfSourceLabel(source)
                                        : source.title || 'Class recording'}
                                    </span>
                                    <span className="block text-[11px] font-medium text-stone-400">
                                      Similarity {formatSimilarityScore(source.score)}
                                    </span>
                                  </div>
                                  <span className="pt-0.5 text-xs font-medium text-stone-400">
                                    {source.contentType === 'video'
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
          ))}

          {sending && (
            <div className="mr-4 rounded-[24px] border border-stone-200 bg-white/85 px-4 py-3 text-sm text-stone-600 shadow-[0_12px_30px_rgba(28,25,23,0.06)]">
              Thinking with the selected resources...
            </div>
          )}

          {!sending && messages.length === 1 && (
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
              Answers are grounded in retrieved passages from {selectedScopeSummary.toLowerCase()}.
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
