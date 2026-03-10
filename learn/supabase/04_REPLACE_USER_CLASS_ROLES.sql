-- Replace boolean class edit access with owner / manager / student roles
-- Run this on an existing database after 03_ADD_USER_CLASS_MEMBERSHIPS.sql

ALTER TABLE public.user_class
  ADD COLUMN IF NOT EXISTS role TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_class'
      AND column_name = 'can_edit'
  ) THEN
    EXECUTE $sql$
      UPDATE public.user_class AS uc
      SET role = CASE
        WHEN c.user_id = uc.user_id THEN 'owner'
        WHEN COALESCE(uc.can_edit, FALSE) THEN 'manager'
        ELSE 'student'
      END
      FROM public.classes AS c
      WHERE c.id = uc.class_id
        AND (uc.role IS NULL OR uc.role NOT IN ('owner', 'manager', 'student'))
    $sql$;
  ELSE
    UPDATE public.user_class AS uc
    SET role = CASE
      WHEN c.user_id = uc.user_id THEN 'owner'
      ELSE COALESCE(uc.role, 'student')
    END
    FROM public.classes AS c
    WHERE c.id = uc.class_id
      AND (uc.role IS NULL OR uc.role NOT IN ('owner', 'manager', 'student'));
  END IF;
END
$$;

INSERT INTO public.user_class (user_id, class_id, role)
SELECT c.user_id, c.id, 'owner'
FROM public.classes AS c
ON CONFLICT (user_id, class_id) DO UPDATE
SET
  role = 'owner',
  updated_at = NOW();

ALTER TABLE public.user_class
  ALTER COLUMN role SET DEFAULT 'student';

UPDATE public.user_class
SET role = 'student'
WHERE role IS NULL;

ALTER TABLE public.user_class
  ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_class_role_check'
      AND conrelid = 'public.user_class'::regclass
  ) THEN
    ALTER TABLE public.user_class
      ADD CONSTRAINT user_class_role_check
      CHECK (role IN ('owner', 'manager', 'student'));
  END IF;
END
$$;

ALTER TABLE public.user_class
  DROP COLUMN IF EXISTS can_edit;

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
      AND user_class.role IN ('owner', 'manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_class_role(target_class_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.classes
      WHERE classes.id = target_class_id
        AND classes.user_id = auth.uid()
    ) THEN 'owner'
    ELSE (
      SELECT user_class.role
      FROM public.user_class
      WHERE user_class.class_id = target_class_id
        AND user_class.user_id = auth.uid()
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_class_members(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_class_role(target_class_id), '') IN ('owner', 'manager');
$$;

CREATE OR REPLACE FUNCTION public.is_class_owner(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_class_role(target_class_id), '') = 'owner';
$$;

CREATE OR REPLACE FUNCTION public.grant_class_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_class (user_id, class_id, role)
  VALUES (NEW.user_id, NEW.id, 'owner')
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    role = 'owner',
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.list_class_viewers(UUID);
CREATE OR REPLACE FUNCTION public.list_class_members(target_class_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  name TEXT,
  role TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_class_members(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to list class members';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.name,
    uc.role,
    uc.created_at
  FROM public.user_class AS uc
  JOIN public.users AS u ON u.id = uc.user_id
  WHERE uc.class_id = target_class_id
  ORDER BY
    CASE uc.role
      WHEN 'owner' THEN 0
      WHEN 'manager' THEN 1
      ELSE 2
    END,
    LOWER(u.name),
    LOWER(u.email);
END;
$$;

DROP FUNCTION IF EXISTS public.add_user_to_class_by_email(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.add_user_to_class_by_email(UUID, TEXT, TEXT);
CREATE FUNCTION public.add_user_to_class_by_email(
  target_class_id UUID,
  target_email TEXT,
  target_role TEXT DEFAULT 'student'
)
RETURNS TABLE (
  added_user_id UUID,
  added_email TEXT,
  added_name TEXT,
  added_class_id UUID,
  added_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  existing_role TEXT;
  matched_user public.users%ROWTYPE;
  normalized_target_role TEXT;
  class_owner_id UUID;
BEGIN
  actor_role := public.get_class_role(target_class_id);

  IF actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized to add users to this class';
  END IF;

  normalized_target_role := LOWER(TRIM(COALESCE(target_role, 'student')));

  IF normalized_target_role NOT IN ('student', 'manager') THEN
    RAISE EXCEPTION 'Invalid role. Use student or manager';
  END IF;

  IF actor_role = 'manager' AND normalized_target_role <> 'student' THEN
    RAISE EXCEPTION 'Managers can only add students';
  END IF;

  SELECT classes.user_id
  INTO class_owner_id
  FROM public.classes
  WHERE classes.id = target_class_id;

  IF class_owner_id IS NULL THEN
    RAISE EXCEPTION 'Class not found';
  END IF;

  SELECT *
  INTO matched_user
  FROM public.users
  WHERE LOWER(users.email) = LOWER(TRIM(target_email))
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'No user found for the provided email';
  END IF;

  IF matched_user.id = class_owner_id THEN
    RAISE EXCEPTION 'The class owner already has access';
  END IF;

  SELECT uc.role
  INTO existing_role
  FROM public.user_class AS uc
  WHERE uc.user_id = matched_user.id
    AND uc.class_id = target_class_id;

  IF actor_role = 'manager' AND existing_role = 'manager' THEN
    RAISE EXCEPTION 'Managers cannot change another manager''s access';
  END IF;

  IF actor_role = 'manager' AND existing_role = 'student' THEN
    RETURN QUERY
    SELECT
      matched_user.id,
      matched_user.email,
      matched_user.name,
      target_class_id,
      existing_role;
    RETURN;
  END IF;

  INSERT INTO public.user_class (user_id, class_id, role)
  VALUES (matched_user.id, target_class_id, normalized_target_role)
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    updated_at = NOW();

  RETURN QUERY
  SELECT
    matched_user.id,
    matched_user.email,
    matched_user.name,
    target_class_id,
    uc.role
  FROM public.user_class AS uc
  WHERE uc.user_id = matched_user.id
    AND uc.class_id = target_class_id;
END;
$$;

DROP FUNCTION IF EXISTS public.update_class_member_role(UUID, UUID, TEXT);
CREATE FUNCTION public.update_class_member_role(
  target_class_id UUID,
  target_user_id UUID,
  target_role TEXT
)
RETURNS TABLE (
  updated_user_id UUID,
  updated_email TEXT,
  updated_name TEXT,
  updated_class_id UUID,
  updated_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_user public.users%ROWTYPE;
  existing_role TEXT;
  normalized_target_role TEXT;
BEGIN
  IF NOT public.is_class_owner(target_class_id) THEN
    RAISE EXCEPTION 'Only the class owner can change member roles';
  END IF;

  normalized_target_role := LOWER(TRIM(COALESCE(target_role, '')));

  IF normalized_target_role NOT IN ('student', 'manager') THEN
    RAISE EXCEPTION 'Invalid role. Use student or manager';
  END IF;

  SELECT *
  INTO matched_user
  FROM public.users
  WHERE users.id = target_user_id
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT uc.role
  INTO existing_role
  FROM public.user_class AS uc
  WHERE uc.user_id = target_user_id
    AND uc.class_id = target_class_id;

  IF existing_role IS NULL THEN
    RAISE EXCEPTION 'User is not enrolled in this class';
  END IF;

  IF existing_role = 'owner' THEN
    RAISE EXCEPTION 'Use ownership transfer to change the owner';
  END IF;

  UPDATE public.user_class
  SET
    role = normalized_target_role,
    updated_at = NOW()
  WHERE class_id = target_class_id
    AND user_id = target_user_id;

  RETURN QUERY
  SELECT
    matched_user.id,
    matched_user.email,
    matched_user.name,
    target_class_id,
    normalized_target_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_from_class(
  target_class_id UUID,
  target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  target_role TEXT;
BEGIN
  actor_role := public.get_class_role(target_class_id);

  IF actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized to remove users from this class';
  END IF;

  SELECT uc.role
  INTO target_role
  FROM public.user_class AS uc
  WHERE uc.class_id = target_class_id
    AND uc.user_id = target_user_id;

  IF target_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the class owner';
  END IF;

  IF actor_role = 'manager' AND target_role <> 'student' THEN
    RAISE EXCEPTION 'Managers can only remove students';
  END IF;

  DELETE FROM public.user_class
  WHERE class_id = target_class_id
    AND user_id = target_user_id;

  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.transfer_class_ownership(UUID, UUID);
CREATE FUNCTION public.transfer_class_ownership(
  target_class_id UUID,
  target_user_id UUID
)
RETURNS TABLE (
  previous_owner_id UUID,
  new_owner_id UUID,
  class_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_owner_id UUID;
  target_member_role TEXT;
BEGIN
  IF NOT public.is_class_owner(target_class_id) THEN
    RAISE EXCEPTION 'Only the class owner can transfer ownership';
  END IF;

  SELECT classes.user_id
  INTO current_owner_id
  FROM public.classes
  WHERE classes.id = target_class_id;

  IF current_owner_id IS NULL THEN
    RAISE EXCEPTION 'Class not found';
  END IF;

  IF current_owner_id = target_user_id THEN
    RAISE EXCEPTION 'This user already owns the class';
  END IF;

  SELECT uc.role
  INTO target_member_role
  FROM public.user_class AS uc
  WHERE uc.class_id = target_class_id
    AND uc.user_id = target_user_id;

  IF target_member_role IS NULL THEN
    RAISE EXCEPTION 'Transfer ownership only to an existing class member';
  END IF;

  UPDATE public.classes
  SET
    user_id = target_user_id,
    updated_at = NOW()
  WHERE id = target_class_id;

  UPDATE public.user_class
  SET
    role = 'manager',
    updated_at = NOW()
  WHERE class_id = target_class_id
    AND user_id = current_owner_id;

  UPDATE public.user_class
  SET
    role = 'owner',
    updated_at = NOW()
  WHERE class_id = target_class_id
    AND user_id = target_user_id;

  RETURN QUERY
  SELECT current_owner_id, target_user_id, target_class_id;
END;
$$;

DROP POLICY IF EXISTS "Users can view memberships for accessible classes" ON public.user_class;
DROP POLICY IF EXISTS "Class owners can add memberships" ON public.user_class;
DROP POLICY IF EXISTS "Class owners can update memberships" ON public.user_class;
DROP POLICY IF EXISTS "Class owners can delete memberships" ON public.user_class;

CREATE POLICY "Users can view memberships for accessible classes"
  ON public.user_class FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.can_manage_class_members(class_id)
  );

CREATE POLICY "Class owners can add memberships"
  ON public.user_class FOR INSERT
  WITH CHECK (public.is_class_owner(class_id));

CREATE POLICY "Class owners can update memberships"
  ON public.user_class FOR UPDATE
  USING (public.is_class_owner(class_id))
  WITH CHECK (public.is_class_owner(class_id));

CREATE POLICY "Class owners can delete memberships"
  ON public.user_class FOR DELETE
  USING (public.is_class_owner(class_id));

DROP POLICY IF EXISTS "Users can update their own classes" ON public.classes;
CREATE POLICY "Users can update their own classes"
  ON public.classes FOR UPDATE
  USING (public.is_class_owner(id))
  WITH CHECK (public.is_class_owner(id));

COMMENT ON TABLE public.user_class IS 'Maps users to classes with owner, manager, or student access';
COMMENT ON COLUMN public.user_class.role IS 'owner can manage roles and transfer ownership; manager can edit class content and add/remove students; student has view-only access';
COMMENT ON FUNCTION public.list_class_members(UUID) IS 'Returns class members and roles for owners or managers of that class';
COMMENT ON FUNCTION public.add_user_to_class_by_email(UUID, TEXT, TEXT) IS 'Adds an existing user to a class by email; managers can add students and owners can add students or managers';
COMMENT ON FUNCTION public.update_class_member_role(UUID, UUID, TEXT) IS 'Allows the class owner to promote or demote members between student and manager';
COMMENT ON FUNCTION public.remove_user_from_class(UUID, UUID) IS 'Allows owners or managers to remove members according to their role permissions';
COMMENT ON FUNCTION public.transfer_class_ownership(UUID, UUID) IS 'Transfers class ownership to another existing member and demotes the previous owner to manager';
