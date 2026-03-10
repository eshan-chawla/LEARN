-- Complete Database Setup with RLS
-- Run this script in Supabase SQL Editor to set up everything from scratch
-- This creates all tables, indexes, triggers, and RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_teacher BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Classes table
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Book Sections table
CREATE TABLE book_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Class membership table
CREATE TABLE user_class (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('owner', 'manager', 'student')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, class_id)
);

-- Recordings table
CREATE TABLE recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  storage_path TEXT,
  duration INTEGER,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Books table
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES book_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  file_size INTEGER,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  storage_path TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notes table
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_id, user_id)
);


-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_classes_user_id ON classes(user_id);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_classes_slug ON classes(slug);
CREATE INDEX idx_book_sections_class_id ON book_sections(class_id);
CREATE INDEX idx_book_sections_class_id_position ON book_sections(class_id, position);
CREATE INDEX idx_user_class_class_id ON user_class(class_id);
CREATE INDEX idx_recordings_class_id ON recordings(class_id);
CREATE INDEX idx_books_class_id ON books(class_id);
CREATE INDEX idx_books_section_id ON books(section_id);
CREATE INDEX idx_books_section_id_position ON books(section_id, position);
CREATE INDEX idx_notes_class_id ON notes(class_id);
CREATE INDEX idx_notes_user_id ON notes(user_id);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_auth_user_to_public_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION can_view_class(target_class_id UUID)
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

CREATE OR REPLACE FUNCTION can_edit_class(target_class_id UUID)
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

CREATE OR REPLACE FUNCTION get_class_role(target_class_id UUID)
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

CREATE OR REPLACE FUNCTION can_manage_class_members(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(get_class_role(target_class_id), '') IN ('owner', 'manager');
$$;

CREATE OR REPLACE FUNCTION is_class_owner(target_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(get_class_role(target_class_id), '') = 'owner';
$$;

CREATE OR REPLACE FUNCTION is_teacher_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = target_user_id
      AND users.is_teacher = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION create_class(
  class_name TEXT,
  class_description TEXT DEFAULT NULL,
  class_slug TEXT DEFAULT NULL
)
RETURNS public.classes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_class public.classes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT is_teacher_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only teachers can create classes';
  END IF;

  INSERT INTO public.classes (user_id, name, description, slug)
  VALUES (auth.uid(), class_name, class_description, class_slug)
  RETURNING * INTO created_class;

  RETURN created_class;
END;
$$;

CREATE OR REPLACE FUNCTION grant_class_owner_membership()
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

CREATE OR REPLACE FUNCTION list_class_members(target_class_id UUID)
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
  IF NOT can_manage_class_members(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to list class members';
  END IF;

  RETURN QUERY
  SELECT
    users.id,
    users.email,
    users.name,
    user_class.role,
    user_class.created_at
  FROM user_class
  JOIN users ON users.id = user_class.user_id
  WHERE user_class.class_id = target_class_id
  ORDER BY
    CASE user_class.role
      WHEN 'owner' THEN 0
      WHEN 'manager' THEN 1
      ELSE 2
    END,
    LOWER(users.name),
    LOWER(users.email);
END;
$$;

DROP FUNCTION IF EXISTS add_user_to_class_by_email(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS add_user_to_class_by_email(UUID, TEXT, TEXT);
CREATE FUNCTION add_user_to_class_by_email(
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
  matched_user users%ROWTYPE;
  normalized_target_role TEXT;
  class_owner_id UUID;
BEGIN
  actor_role := get_class_role(target_class_id);

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

  SELECT user_id
  INTO class_owner_id
  FROM classes
  WHERE id = target_class_id;

  IF class_owner_id IS NULL THEN
    RAISE EXCEPTION 'Class not found';
  END IF;

  SELECT *
  INTO matched_user
  FROM users
  WHERE LOWER(users.email) = LOWER(TRIM(target_email))
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'No user found for the provided email';
  END IF;

  IF matched_user.id = class_owner_id THEN
    RAISE EXCEPTION 'The class owner already has access';
  END IF;

  SELECT user_class.role
  INTO existing_role
  FROM user_class
  WHERE user_class.user_id = matched_user.id
    AND user_class.class_id = target_class_id;

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

  INSERT INTO user_class (user_id, class_id, role)
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
  FROM user_class AS uc
  WHERE uc.user_id = matched_user.id
    AND uc.class_id = target_class_id;
END;
$$;

DROP FUNCTION IF EXISTS update_class_member_role(UUID, UUID, TEXT);
CREATE FUNCTION update_class_member_role(
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
  matched_user users%ROWTYPE;
  existing_role TEXT;
  normalized_target_role TEXT;
BEGIN
  IF NOT is_class_owner(target_class_id) THEN
    RAISE EXCEPTION 'Only the class owner can change member roles';
  END IF;

  normalized_target_role := LOWER(TRIM(COALESCE(target_role, '')));

  IF normalized_target_role NOT IN ('student', 'manager') THEN
    RAISE EXCEPTION 'Invalid role. Use student or manager';
  END IF;

  SELECT *
  INTO matched_user
  FROM users
  WHERE users.id = target_user_id
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT user_class.role
  INTO existing_role
  FROM user_class
  WHERE user_class.user_id = target_user_id
    AND user_class.class_id = target_class_id;

  IF existing_role IS NULL THEN
    RAISE EXCEPTION 'User is not enrolled in this class';
  END IF;

  IF existing_role = 'owner' THEN
    RAISE EXCEPTION 'Use ownership transfer to change the owner';
  END IF;

  UPDATE user_class
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

DROP FUNCTION IF EXISTS remove_user_from_class(UUID, UUID);
CREATE FUNCTION remove_user_from_class(
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
  actor_role := get_class_role(target_class_id);

  IF actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized to remove users from this class';
  END IF;

  SELECT user_class.role
  INTO target_role
  FROM user_class
  WHERE user_class.class_id = target_class_id
    AND user_class.user_id = target_user_id;

  IF target_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the class owner';
  END IF;

  IF actor_role = 'manager' AND target_role <> 'student' THEN
    RAISE EXCEPTION 'Managers can only remove students';
  END IF;

  DELETE FROM user_class
  WHERE class_id = target_class_id
    AND user_id = target_user_id;

  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS transfer_class_ownership(UUID, UUID);
CREATE FUNCTION transfer_class_ownership(
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
  IF NOT is_class_owner(target_class_id) THEN
    RAISE EXCEPTION 'Only the class owner can transfer ownership';
  END IF;

  SELECT classes.user_id
  INTO current_owner_id
  FROM classes
  WHERE classes.id = target_class_id;

  IF current_owner_id IS NULL THEN
    RAISE EXCEPTION 'Class not found';
  END IF;

  IF current_owner_id = target_user_id THEN
    RAISE EXCEPTION 'This user already owns the class';
  END IF;

  SELECT user_class.role
  INTO target_member_role
  FROM user_class
  WHERE user_class.class_id = target_class_id
    AND user_class.user_id = target_user_id;

  IF target_member_role IS NULL THEN
    RAISE EXCEPTION 'Transfer ownership only to an existing class member';
  END IF;

  UPDATE classes
  SET
    user_id = target_user_id,
    updated_at = NOW()
  WHERE id = target_class_id;

  UPDATE user_class
  SET
    role = 'manager',
    updated_at = NOW()
  WHERE class_id = target_class_id
    AND user_id = current_owner_id;

  UPDATE user_class
  SET
    role = 'owner',
    updated_at = NOW()
  WHERE class_id = target_class_id
    AND user_id = target_user_id;

  RETURN QUERY
  SELECT current_owner_id, target_user_id, target_class_id;
END;
$$;

-- Triggers for each table
CREATE TRIGGER trigger_update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_book_sections_updated_at
  BEFORE UPDATE ON book_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_user_class_updated_at
  BEFORE UPDATE ON user_class
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_recordings_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_auth_user_to_public_users();

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_auth_user_to_public_users();

CREATE TRIGGER on_class_created_grant_owner_membership
  AFTER INSERT ON classes
  FOR EACH ROW
  EXECUTE FUNCTION grant_class_owner_membership();

INSERT INTO public.users (id, email, name)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  name = COALESCE(EXCLUDED.name, public.users.name),
  updated_at = NOW();

INSERT INTO public.user_class (user_id, class_id, role)
SELECT user_id, id, 'owner'
FROM public.classes
ON CONFLICT (user_id, class_id) DO UPDATE
SET
  role = 'owner',
  updated_at = NOW();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: USERS
-- ============================================================================

CREATE POLICY "Users can view their own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can create their own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- RLS POLICIES: BOOK_SECTIONS
-- ============================================================================

CREATE POLICY "Users can view book sections for accessible classes"
  ON book_sections FOR SELECT
  USING (can_view_class(class_id));

CREATE POLICY "Users can create book sections for editable classes"
  ON book_sections FOR INSERT
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can update book sections for editable classes"
  ON book_sections FOR UPDATE
  USING (can_edit_class(class_id))
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can delete book sections for editable classes"
  ON book_sections FOR DELETE
  USING (can_edit_class(class_id));

-- ============================================================================
-- RLS POLICIES: USER_CLASS
-- ============================================================================

CREATE POLICY "Users can view memberships for accessible classes"
  ON user_class FOR SELECT
  USING (
    auth.uid() = user_id
    OR can_manage_class_members(class_id)
  );

CREATE POLICY "Class owners can add memberships"
  ON user_class FOR INSERT
  WITH CHECK (is_class_owner(class_id));

CREATE POLICY "Class owners can update memberships"
  ON user_class FOR UPDATE
  USING (is_class_owner(class_id))
  WITH CHECK (is_class_owner(class_id));

CREATE POLICY "Class owners can delete memberships"
  ON user_class FOR DELETE
  USING (is_class_owner(class_id));

-- ============================================================================
-- RLS POLICIES: CLASSES
-- ============================================================================

CREATE POLICY "Users can view their own classes"
  ON classes FOR SELECT
  USING (can_view_class(id));

CREATE POLICY "Users can create their own classes"
  ON classes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND is_teacher_user(auth.uid())
  );

CREATE POLICY "Users can update their own classes"
  ON classes FOR UPDATE
  USING (is_class_owner(id))
  WITH CHECK (is_class_owner(id));

CREATE POLICY "Users can delete their own classes"
  ON classes FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES: RECORDINGS
-- ============================================================================

CREATE POLICY "Users can view recordings of their classes"
  ON recordings FOR SELECT
  USING (can_view_class(class_id));

CREATE POLICY "Users can create recordings for their classes"
  ON recordings FOR INSERT
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can update recordings of their classes"
  ON recordings FOR UPDATE
  USING (can_edit_class(class_id))
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can delete recordings of their classes"
  ON recordings FOR DELETE
  USING (can_edit_class(class_id));

-- ============================================================================
-- RLS POLICIES: BOOKS
-- ============================================================================

CREATE POLICY "Users can view books of their classes"
  ON books FOR SELECT
  USING (can_view_class(class_id));

CREATE POLICY "Users can create books for their classes"
  ON books FOR INSERT
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can update books of their classes"
  ON books FOR UPDATE
  USING (can_edit_class(class_id))
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can delete books of their classes"
  ON books FOR DELETE
  USING (can_edit_class(class_id));

-- ============================================================================
-- RLS POLICIES: NOTES
-- ============================================================================

CREATE POLICY "Users can view their own notes for accessible classes"
  ON notes FOR SELECT
  USING (
    user_id = auth.uid()
    AND can_view_class(class_id)
  );

CREATE POLICY "Users can create their own notes for accessible classes"
  ON notes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND can_view_class(class_id)
  );

CREATE POLICY "Users can update their own notes for accessible classes"
  ON notes FOR UPDATE
  USING (
    user_id = auth.uid()
    AND can_view_class(class_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND can_view_class(class_id)
  );

CREATE POLICY "Users can delete their own notes for accessible classes"
  ON notes FOR DELETE
  USING (
    user_id = auth.uid()
    AND can_view_class(class_id)
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE classes IS 'Classes created by users';
COMMENT ON TABLE users IS 'Application user profiles synced from auth.users';
COMMENT ON TABLE book_sections IS 'Ordered sections inside a class that group books';
COMMENT ON TABLE user_class IS 'Maps users to classes with owner, manager, or student access';
COMMENT ON TABLE recordings IS 'Video recordings for classes';
COMMENT ON TABLE books IS 'PDF books/documents for classes';
COMMENT ON TABLE notes IS 'Private markdown notes per user per class';

COMMENT ON COLUMN classes.user_id IS 'UUID of the user who owns this class (matches auth.users.id)';
COMMENT ON COLUMN users.is_teacher IS 'Only teachers can create classes';
COMMENT ON COLUMN book_sections.position IS 'Display order of the section inside the class';
COMMENT ON COLUMN user_class.role IS 'owner can manage roles and transfer ownership; manager can edit class content and add/remove students; student has view-only access';
COMMENT ON COLUMN notes.content IS 'Markdown note content for a specific user and class';
COMMENT ON COLUMN classes.slug IS 'URL-friendly slug for the class';
COMMENT ON COLUMN books.processing_status IS 'Status of PDF processing: pending, processing, completed, or failed';
COMMENT ON COLUMN books.error_message IS 'Error details if processing_status is failed';
COMMENT ON COLUMN books.storage_path IS 'S3 key for the PDF (e.g., books/class-id/file.pdf)';
COMMENT ON COLUMN books.position IS 'Display order of the book inside its section';
COMMENT ON FUNCTION create_class(TEXT, TEXT, TEXT) IS 'Creates a class for the current authenticated teacher user';
COMMENT ON FUNCTION list_class_members(UUID) IS 'Returns class members and roles for owners or managers of that class';
COMMENT ON FUNCTION add_user_to_class_by_email(UUID, TEXT, TEXT) IS 'Adds an existing user to a class by email; managers can add students and owners can add students or managers';
COMMENT ON FUNCTION update_class_member_role(UUID, UUID, TEXT) IS 'Allows the class owner to promote or demote members between student and manager';
COMMENT ON FUNCTION remove_user_from_class(UUID, UUID) IS 'Allows owners or managers to remove members according to their role permissions';
COMMENT ON FUNCTION transfer_class_ownership(UUID, UUID) IS 'Transfers class ownership to another existing member and demotes the previous owner to manager';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 'Database setup complete! All tables, indexes, triggers, and RLS policies have been created.' as status;
