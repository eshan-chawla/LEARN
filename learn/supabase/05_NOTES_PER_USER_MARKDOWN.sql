-- Convert notes from one-per-class to one-per-user-per-class
-- Existing notes are reassigned to the class owner

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

UPDATE public.notes AS notes
SET user_id = classes.user_id
FROM public.classes AS classes
WHERE classes.id = notes.class_id
  AND notes.user_id IS NULL;

ALTER TABLE public.notes
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_class_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_class_id_user_id_key'
      AND conrelid = 'public.notes'::regclass
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_class_id_user_id_key UNIQUE (class_id, user_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_notes_user_id
  ON public.notes(user_id);

DROP POLICY IF EXISTS "Users can view notes of their classes" ON public.notes;
DROP POLICY IF EXISTS "Users can create notes for their classes" ON public.notes;
DROP POLICY IF EXISTS "Users can update notes of their classes" ON public.notes;
DROP POLICY IF EXISTS "Users can delete notes of their classes" ON public.notes;
DROP POLICY IF EXISTS "Users can view their own notes for accessible classes" ON public.notes;
DROP POLICY IF EXISTS "Users can create their own notes for accessible classes" ON public.notes;
DROP POLICY IF EXISTS "Users can update their own notes for accessible classes" ON public.notes;
DROP POLICY IF EXISTS "Users can delete their own notes for accessible classes" ON public.notes;

CREATE POLICY "Users can view their own notes for accessible classes"
  ON public.notes FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.can_view_class(class_id)
  );

CREATE POLICY "Users can create their own notes for accessible classes"
  ON public.notes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_view_class(class_id)
  );

CREATE POLICY "Users can update their own notes for accessible classes"
  ON public.notes FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.can_view_class(class_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_view_class(class_id)
  );

CREATE POLICY "Users can delete their own notes for accessible classes"
  ON public.notes FOR DELETE
  USING (
    user_id = auth.uid()
    AND public.can_view_class(class_id)
  );

COMMENT ON TABLE public.notes IS 'Private markdown notes per user per class';
COMMENT ON COLUMN public.notes.content IS 'Markdown note content for a specific user and class';
