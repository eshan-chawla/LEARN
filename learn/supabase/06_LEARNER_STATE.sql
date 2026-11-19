-- Structured learner model: per-class prerequisite graphs, per-student learner state,
-- and an append-only event log used for the mastery map and for evaluation.
--
-- The graph and state are stored as JSONB documents matching the TypeScript types in
-- learn/lib/tutor/types.ts (ConceptGraphSpec, LearnerState). Graphs are versioned so a
-- state can always be interpreted against the graph it was produced with.

-- ---------------------------------------------------------------------------
-- concept_graphs: one active prerequisite DAG per class (older versions kept)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.concept_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  spec JSONB NOT NULL CHECK (jsonb_typeof(spec -> 'concepts') = 'array' AND jsonb_typeof(spec -> 'edges') = 'array'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, version)
);

-- At most one active graph per class.
CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_graphs_one_active
  ON public.concept_graphs(class_id)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- learner_states: current S_t for each (student, class)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  graph_id UUID NOT NULL REFERENCES public.concept_graphs(id) ON DELETE CASCADE,
  state JSONB NOT NULL CHECK ((state ->> 'schemaVersion') = '1'),
  -- Tutor bookkeeping between turns, e.g. the probe awaiting an answer.
  pending_probe JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_states_class_id
  ON public.learner_states(class_id);

-- ---------------------------------------------------------------------------
-- learner_events: one row per tutor turn (diagnosis, observations, decision)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  graph_id UUID NOT NULL REFERENCES public.concept_graphs(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL CHECK (turn >= 0),
  diagnosis JSONB NOT NULL,
  decision JSONB NOT NULL,
  -- Compact per-concept mastery snapshot after the update, for plots and the mastery map.
  mastery_after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learner_events_user_class_turn
  ON public.learner_events(user_id, class_id, turn);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.concept_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Class members can view concept graphs" ON public.concept_graphs;
DROP POLICY IF EXISTS "Class editors can manage concept graphs" ON public.concept_graphs;
DROP POLICY IF EXISTS "Students can view their own learner state" ON public.learner_states;
DROP POLICY IF EXISTS "Students can create their own learner state" ON public.learner_states;
DROP POLICY IF EXISTS "Students can update their own learner state" ON public.learner_states;
DROP POLICY IF EXISTS "Students can delete their own learner state" ON public.learner_states;
DROP POLICY IF EXISTS "Class editors can view learner states" ON public.learner_states;
DROP POLICY IF EXISTS "Students can view their own learner events" ON public.learner_events;
DROP POLICY IF EXISTS "Students can append their own learner events" ON public.learner_events;
DROP POLICY IF EXISTS "Class editors can view learner events" ON public.learner_events;

CREATE POLICY "Class members can view concept graphs"
  ON public.concept_graphs FOR SELECT
  USING (public.can_view_class(class_id));

CREATE POLICY "Class editors can manage concept graphs"
  ON public.concept_graphs FOR ALL
  USING (public.can_edit_class(class_id))
  WITH CHECK (public.can_edit_class(class_id));

CREATE POLICY "Students can view their own learner state"
  ON public.learner_states FOR SELECT
  USING (user_id = auth.uid() AND public.can_view_class(class_id));

CREATE POLICY "Students can create their own learner state"
  ON public.learner_states FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.can_view_class(class_id));

CREATE POLICY "Students can update their own learner state"
  ON public.learner_states FOR UPDATE
  USING (user_id = auth.uid() AND public.can_view_class(class_id))
  WITH CHECK (user_id = auth.uid() AND public.can_view_class(class_id));

-- Lets a student reset their own learner model.
CREATE POLICY "Students can delete their own learner state"
  ON public.learner_states FOR DELETE
  USING (user_id = auth.uid());

-- Instructors (owner/manager) can see learner models in their classes, read-only.
CREATE POLICY "Class editors can view learner states"
  ON public.learner_states FOR SELECT
  USING (public.can_edit_class(class_id));

CREATE POLICY "Students can view their own learner events"
  ON public.learner_events FOR SELECT
  USING (user_id = auth.uid() AND public.can_view_class(class_id));

-- Append-only: no UPDATE/DELETE policies, so events cannot be rewritten through the API.
CREATE POLICY "Students can append their own learner events"
  ON public.learner_events FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.can_view_class(class_id));

CREATE POLICY "Class editors can view learner events"
  ON public.learner_events FOR SELECT
  USING (public.can_edit_class(class_id));

COMMENT ON TABLE public.concept_graphs IS 'Versioned per-class prerequisite DAG (ConceptGraphSpec JSON)';
COMMENT ON TABLE public.learner_states IS 'Current structured learner state S_t per student per class (LearnerState JSON)';
COMMENT ON TABLE public.learner_events IS 'Append-only per-turn diagnosis, policy decision, and mastery snapshot';
