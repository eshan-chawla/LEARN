-- Adds class memberships via public.user_class and updates access control so:
-- - mapped users can view a class
-- - mapped users with can_edit = true can edit class content
-- Run this after 02_ADD_USERS_TABLE_AND_TEACHER_ROLE.sql on existing databases.

CREATE TABLE IF NOT EXISTS public.user_class (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, class_id)
);

ALTER TABLE public.user_class
  ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_class_class_id ON public.user_class(class_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.can_view_class(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classes
    WHERE classes.id = target_class_id
      AND classes.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_class
    WHERE user_class.class_id = target_class_id
      AND user_class.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_class(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classes
    WHERE classes.id = target_class_id
      AND classes.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_class
    WHERE user_class.class_id = target_class_id
      AND user_class.user_id = auth.uid()
      AND user_class.can_edit = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.grant_class_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_class (user_id, class_id, can_edit)
  VALUES (NEW.user_id, NEW.id, TRUE)
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    can_edit = TRUE,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_class_viewers(target_class_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  name TEXT,
  can_edit BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_edit_class(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to list class viewers';
  END IF;

  RETURN QUERY
  SELECT
    users.id,
    users.email,
    users.name,
    user_class.can_edit,
    user_class.created_at
  FROM public.user_class
  JOIN public.users ON users.id = user_class.user_id
  WHERE user_class.class_id = target_class_id
    AND user_class.can_edit = FALSE
  ORDER BY LOWER(users.name), LOWER(users.email);
END;
$$;

DROP FUNCTION IF EXISTS public.add_user_to_class_by_email(UUID, TEXT, BOOLEAN);
CREATE FUNCTION public.add_user_to_class_by_email(
  target_class_id UUID,
  target_email TEXT,
  target_can_edit BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  added_user_id UUID,
  added_email TEXT,
  added_name TEXT,
  added_class_id UUID,
  added_can_edit BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_user public.users%ROWTYPE;
BEGIN
  IF NOT public.can_edit_class(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to add users to this class';
  END IF;

  SELECT *
  INTO matched_user
  FROM public.users
  WHERE LOWER(users.email) = LOWER(TRIM(target_email))
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'No user found for the provided email';
  END IF;

  INSERT INTO public.user_class (user_id, class_id, can_edit)
  VALUES (matched_user.id, target_class_id, target_can_edit)
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    can_edit = public.user_class.can_edit OR EXCLUDED.can_edit,
    updated_at = NOW();

  RETURN QUERY
  SELECT
    matched_user.id,
    matched_user.email,
    matched_user.name,
    target_class_id,
    uc.can_edit
  FROM public.user_class AS uc
  WHERE uc.user_id = matched_user.id
    AND uc.class_id = target_class_id;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_user_class_updated_at ON public.user_class;
CREATE TRIGGER trigger_update_user_class_updated_at
  BEFORE UPDATE ON public.user_class
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS on_class_created_grant_owner_membership ON public.classes;
CREATE TRIGGER on_class_created_grant_owner_membership
  AFTER INSERT ON public.classes
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_class_owner_membership();

INSERT INTO public.user_class (user_id, class_id, can_edit)
SELECT user_id, id, TRUE
FROM public.classes
ON CONFLICT (user_id, class_id) DO UPDATE
SET
  can_edit = TRUE,
  updated_at = NOW();

ALTER TABLE public.user_class ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view memberships for accessible classes" ON public.user_class;
CREATE POLICY "Users can view memberships for accessible classes"
  ON public.user_class FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Class owners can add memberships" ON public.user_class;
CREATE POLICY "Class owners can add memberships"
  ON public.user_class FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Class owners can update memberships" ON public.user_class;
CREATE POLICY "Class owners can update memberships"
  ON public.user_class FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Class owners can delete memberships" ON public.user_class;
CREATE POLICY "Class owners can delete memberships"
  ON public.user_class FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view their own classes" ON public.classes;
CREATE POLICY "Users can view their own classes"
  ON public.classes FOR SELECT
  USING (public.can_view_class(id));

DROP POLICY IF EXISTS "Users can update their own classes" ON public.classes;
CREATE POLICY "Users can update their own classes"
  ON public.classes FOR UPDATE
  USING (public.can_edit_class(id))
  WITH CHECK (public.can_edit_class(id));

DROP POLICY IF EXISTS "Users can view recordings of their classes" ON public.recordings;
CREATE POLICY "Users can view recordings of their classes"
  ON public.recordings FOR SELECT
  USING (public.can_view_class(class_id));

DROP POLICY IF EXISTS "Users can create recordings for their classes" ON public.recordings;
CREATE POLICY "Users can create recordings for their classes"
  ON public.recordings FOR INSERT
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can update recordings of their classes" ON public.recordings;
CREATE POLICY "Users can update recordings of their classes"
  ON public.recordings FOR UPDATE
  USING (public.can_edit_class(class_id))
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can delete recordings of their classes" ON public.recordings;
CREATE POLICY "Users can delete recordings of their classes"
  ON public.recordings FOR DELETE
  USING (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can view books of their classes" ON public.books;
CREATE POLICY "Users can view books of their classes"
  ON public.books FOR SELECT
  USING (public.can_view_class(class_id));

DROP POLICY IF EXISTS "Users can create books for their classes" ON public.books;
CREATE POLICY "Users can create books for their classes"
  ON public.books FOR INSERT
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can update books of their classes" ON public.books;
CREATE POLICY "Users can update books of their classes"
  ON public.books FOR UPDATE
  USING (public.can_edit_class(class_id))
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can delete books of their classes" ON public.books;
CREATE POLICY "Users can delete books of their classes"
  ON public.books FOR DELETE
  USING (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can view notes of their classes" ON public.notes;
CREATE POLICY "Users can view notes of their classes"
  ON public.notes FOR SELECT
  USING (public.can_view_class(class_id));

DROP POLICY IF EXISTS "Users can create notes for their classes" ON public.notes;
CREATE POLICY "Users can create notes for their classes"
  ON public.notes FOR INSERT
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can update notes of their classes" ON public.notes;
CREATE POLICY "Users can update notes of their classes"
  ON public.notes FOR UPDATE
  USING (public.can_edit_class(class_id))
  WITH CHECK (public.can_edit_class(class_id));

DROP POLICY IF EXISTS "Users can delete notes of their classes" ON public.notes;
CREATE POLICY "Users can delete notes of their classes"
  ON public.notes FOR DELETE
  USING (public.can_edit_class(class_id));

COMMENT ON TABLE public.user_class IS 'Maps users to classes with viewer/editor access';
COMMENT ON COLUMN public.user_class.can_edit IS 'TRUE means the user can edit class content; FALSE means view-only access';
COMMENT ON FUNCTION public.list_class_viewers(UUID) IS 'Returns view-only class members for editors of that class';
COMMENT ON FUNCTION public.add_user_to_class_by_email(UUID, TEXT, BOOLEAN) IS 'Adds an existing user to a class by email for editors of that class';

SELECT 'User-class memberships and access controls applied successfully.' AS status;
