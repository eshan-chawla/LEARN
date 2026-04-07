'use client';

import { supabase } from '@/lib/supabase';
import { useEffect, useRef, useState } from 'react';

type ChatRole = 'user' | 'assistant';

interface ChatSource {
  pageNumber: number | null;
  excerpt: string;
  score: number;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
}

interface BookAskAIPanelProps {
  bookId: string;
  classId: string;
  bookTitle: string;
  open: boolean;
  onClose: () => void;
  onJumpToPage: (pageNumber: number) => void;
}

function createMessage(role: ChatRole, content: string, sources?: ChatSource[]): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    sources,
  };
}

export function BookAskAIPanel({
  bookId,
  classId,
  bookTitle,
  open,
  onClose,
  onJumpToPage,
}: BookAskAIPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage(
      'assistant',
      `Ask about ${bookTitle}. I will answer from this book's indexed passages and point you to relevant pages when I can.`
    ),
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    setMessages([
      createMessage(
        'assistant',
        `Ask about ${bookTitle}. I will answer from this book's indexed passages and point you to relevant pages when I can.`
      ),
    ]);
    setExpandedSources({});
    setInput('');
    setError(null);
  }, [bookId, bookTitle]);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

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

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-20 flex w-[24rem] flex-col overflow-hidden bg-[rgba(250,247,242,0.98)] transition-[transform,width,opacity,box-shadow,border-color] duration-300 md:relative md:inset-y-auto md:right-auto md:z-0 md:flex-shrink-0 md:translate-x-0 ${open ? 'pointer-events-auto translate-x-0 border-l border-stone-200/80 opacity-100 shadow-[-24px_24px_60px_rgba(28,25,23,0.12)] md:w-[24rem] md:shadow-none' : 'pointer-events-none translate-x-full border-l border-transparent opacity-100 md:w-0 md:translate-x-0 md:border-l-0 md:opacity-0 md:shadow-none'}`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-200/80 px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Ask AI</p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Grounded answers from this book only.
          </p>
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
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedSources((current) => ({
                        ...current,
                        [message.id]: !(current[message.id] ?? false),
                      }));
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border border-stone-200 bg-stone-50/80 px-3 py-3 text-left transition hover:border-stone-300 hover:bg-white"
                  >
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                        Sources
                      </p>
                      <p className="mt-1 text-sm text-stone-600">
                        {message.sources.length} citation{message.sources.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <svg
                      className={`h-4 w-4 flex-shrink-0 text-stone-500 transition-transform ${(expandedSources[message.id] ?? false) ? 'rotate-90' : 'rotate-0'}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  <div className={`grid transition-[grid-template-rows] duration-300 ${(expandedSources[message.id] ?? false) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="space-y-2 pt-1">
                        {message.sources.map((source, index) => (
                          <div key={`${message.id}-${index}`} className="group relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (source.pageNumber) {
                                  onJumpToPage(source.pageNumber);
                                }
                              }}
                              className="w-full rounded-2xl border border-stone-200 bg-stone-50/80 px-3 py-3 text-left transition hover:border-stone-300 hover:bg-white disabled:cursor-default"
                              disabled={!source.pageNumber}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                                  {source.pageNumber ? `Page ${source.pageNumber}` : 'Page unavailable'}
                                </span>
                                <span className="text-xs font-medium text-stone-400">
                                  {source.pageNumber ? 'Hover to preview' : 'No page link'}
                                </span>
                              </div>
                            </button>

                            <div className="pointer-events-none absolute left-3 right-3 top-full z-20 mt-2 hidden rounded-[20px] border border-stone-200 bg-[rgba(255,253,249,0.98)] p-4 text-sm leading-6 text-stone-600 opacity-0 shadow-[0_24px_60px_rgba(28,25,23,0.14)] transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:block">
                              {source.excerpt}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="mr-4 rounded-[24px] border border-stone-200 bg-white/85 px-4 py-3 text-sm text-stone-600 shadow-[0_12px_30px_rgba(28,25,23,0.06)]">
              Thinking with the current book...
            </div>
          )}

          {!sending && messages.length === 1 && (
            <div className="rounded-[24px] border border-dashed border-stone-200 bg-white/65 px-4 py-5 text-sm leading-6 text-stone-500">
              Try asking for a definition, a summary of a concept, or where a topic is discussed in the current book.
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
              Answers are grounded in retrieved passages from this book.
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
