import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ASK_AI_MODEL, normalizeAskAiModel } from '@/lib/ask-ai/models';
import { createSupabaseClient } from '@/lib/supabase';
import { masteryView, parseTutorRequest } from '@/lib/tutor/api';
import { createTutorDeps } from '@/lib/tutor/app-deps';
import { handleTutorTurn } from '@/lib/tutor/session-store';
import { createSupabaseTutorStore } from '@/lib/tutor/supabase-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Diagnoser + retrieval + generation + critic can exceed the default function timeout.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ classId: string }> };

/** Resolves the caller from the bearer token; the returned client carries it, so RLS applies. */
async function authenticate(request: NextRequest): Promise<{ client: SupabaseClient; userId: string } | null> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  const client = createSupabaseClient(token);
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : { client, userId: data.user.id };
}

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticate(request);
    if (!auth) return unauthorized();
    const { classId } = await params;

    const body = await request.json().catch(() => null);
    const defaultModel = normalizeAskAiModel(process.env.ASK_AI_CHAT_MODEL, DEFAULT_ASK_AI_MODEL);
    const parsed = parseTutorRequest(body, defaultModel);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const outcome = await handleTutorTurn(
      createSupabaseTutorStore(auth.client),
      { userId: auth.userId, classId, message: parsed.message },
      createTutorDeps({ model: parsed.model })
    );

    if (outcome.status === 'no_graph') {
      return NextResponse.json({ error: 'No concept graph for this class' }, { status: 404 });
    }
    if (outcome.status === 'conflict') {
      return NextResponse.json({ error: 'Your learner state changed in another tab. Please resend.' }, { status: 409 });
    }

    const { result, graph } = outcome;
    return NextResponse.json({
      reply: result.reply,
      action: result.action,
      rationale: result.decision?.rationale ?? [],
      steps: result.steps,
      excerpts: result.excerpts,
      pendingProbe: result.session.pendingProbe,
      mastery: masteryView(graph, result.session.state),
      warnings: result.warnings,
    });
  } catch (error) {
    console.error('Tutor error:', error);
    return NextResponse.json({ error: 'The tutor failed to respond. Please try again.' }, { status: 500 });
  }
}

/** Graph + current mastery for the mastery map, and the stored recent history. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticate(request);
    if (!auth) return unauthorized();
    const { classId } = await params;
    const store = createSupabaseTutorStore(auth.client);

    const active = await store.loadActiveGraph(classId);
    if (!active) return NextResponse.json({ graph: null, mastery: {}, history: [] });
    const stored = await store.loadLearnerState(auth.userId, classId);
    return NextResponse.json({
      graph: active.spec,
      mastery: masteryView(active.spec, stored?.state ?? null),
      history: stored?.tutorContext.history ?? [],
    });
  } catch (error) {
    console.error('Tutor state error:', error);
    return NextResponse.json({ error: 'Failed to load learner state' }, { status: 500 });
  }
}

/** Resets the caller's learner model for this class (RLS: students may delete only their own row). */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await authenticate(request);
  if (!auth) return unauthorized();
  const { classId } = await params;
  const { error } = await auth.client.from('learner_states').delete().eq('user_id', auth.userId).eq('class_id', classId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
