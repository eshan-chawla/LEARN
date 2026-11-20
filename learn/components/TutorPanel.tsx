'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MasteryMap } from '@/components/MasteryMap';
import type { MasteryView } from '@/lib/tutor/api';
import type { TutorStep } from '@/lib/tutor/pipeline';
import type { TutorAction } from '@/lib/tutor/policy';
import type { ConceptGraphSpec } from '@/lib/tutor/types';

interface TutorMessage {
  role: 'student' | 'tutor';
  content: string;
  rationale?: string[];
  steps?: TutorStep[];
}

interface TutorPanelProps {
  classId: string;
  getAccessToken: () => Promise<string | null>;
}

function focusOf(action: TutorAction | null): string[] {
  if (!action) return [];
  switch (action.type) {
    case 'probe_prerequisite':
    case 'remediate_prerequisite':
      return [action.conceptId, action.prerequisiteId];
    case 'advance':
      return [action.nextConceptId];
    case 'answer':
      return action.conceptId ? [action.conceptId] : [];
    default:
      return [action.conceptId];
  }
}

/** Chat with the state-conditioned tutor, with the live mastery map and per-reply "why". */
export function TutorPanel({ classId, getAccessToken }: TutorPanelProps) {
  const [graph, setGraph] = useState<ConceptGraphSpec | null>(null);
  const [mastery, setMastery] = useState<MasteryView>({});
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Your session expired. Please sign in again.');
      const response = await fetch(`/api/tutor/${classId}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      return payload;
    },
    [classId, getAccessToken]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await request('GET');
      setGraph(payload.graph);
      setMastery(payload.mastery ?? {});
      setMessages(payload.history ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput('');
    setError(null);
    setSending(true);
    setMessages((current) => [...current, { role: 'student', content: message }]);
    try {
      const payload = await request('POST', { message });
      setMessages((current) => [
        ...current,
        { role: 'tutor', content: payload.reply, rationale: payload.rationale, steps: payload.steps },
      ]);
      setMastery(payload.mastery ?? {});
      setFocus(focusOf(payload.action));
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setInput(message);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function reset() {
    if (!window.confirm('Reset your learner model for this class? Your mastery estimates will start over.')) return;
    try {
      await request('DELETE');
      setFocus([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <p className="text-sm text-stone-600">Loading tutor…</p>;
  if (!graph) {
    return (
      <p className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-700">
        {error ?? 'This class has no concept graph yet. An instructor can seed one with `npm run graph:seed -- --class <class id>`.'}
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex min-h-[32rem] flex-col rounded-[24px] border border-stone-200 bg-white/80 p-4">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-stone-600">
              Ask about any topic from the course, or try answering a question. The tutor tracks what you know and adapts.
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'student' ? 'ml-8' : 'mr-8'}>
              <div
                className={
                  message.role === 'student'
                    ? 'rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white'
                    : 'rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-slate-900'
                }
              >
                {message.role === 'tutor' ? <MarkdownContent>{message.content}</MarkdownContent> : message.content}
              </div>
              {message.role === 'tutor' && (message.rationale?.length || message.steps?.length) ? (
                <details className="mt-1 text-xs text-stone-600">
                  <summary className="cursor-pointer select-none">Why this response</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {message.rationale?.map((line, i) => <li key={`r${i}`}>{line}</li>)}
                    {message.steps?.map((step) => (
                      <li key={step.id} className={step.ok ? '' : 'text-rose-700'}>
                        {step.title}: {step.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ))}
          {sending && <p className="text-xs text-stone-500">Tutor is thinking…</p>}
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        <form onSubmit={send} className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={4000}
            placeholder="Ask a question or answer the tutor…"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </section>

      <section className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Your mastery map</h2>
          <button onClick={reset} className="text-xs text-stone-600 underline hover:text-slate-900">
            Reset
          </button>
        </div>
        <MasteryMap spec={graph} mastery={mastery} highlight={focus} />
      </section>
    </div>
  );
}
