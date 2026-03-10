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
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
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
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_id)
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
      AND user_class.can_edit = TRUE
  );
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
  INSERT INTO public.user_class (user_id, class_id, can_edit)
  VALUES (NEW.user_id, NEW.id, TRUE)
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    can_edit = TRUE,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION list_class_viewers(target_class_id UUID)
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
  IF NOT can_edit_class(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to list class viewers';
  END IF;

  RETURN QUERY
  SELECT
    users.id,
    users.email,
    users.name,
    user_class.can_edit,
    user_class.created_at
  FROM user_class
  JOIN users ON users.id = user_class.user_id
  WHERE user_class.class_id = target_class_id
    AND user_class.can_edit = FALSE
  ORDER BY LOWER(users.name), LOWER(users.email);
END;
$$;

DROP FUNCTION IF EXISTS add_user_to_class_by_email(UUID, TEXT, BOOLEAN);
CREATE FUNCTION add_user_to_class_by_email(
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
  matched_user users%ROWTYPE;
BEGIN
  IF NOT can_edit_class(target_class_id) THEN
    RAISE EXCEPTION 'Unauthorized to add users to this class';
  END IF;

  SELECT *
  INTO matched_user
  FROM users
  WHERE LOWER(users.email) = LOWER(TRIM(target_email))
  LIMIT 1;

  IF matched_user.id IS NULL THEN
    RAISE EXCEPTION 'No user found for the provided email';
  END IF;

  INSERT INTO user_class (user_id, class_id, can_edit)
  VALUES (matched_user.id, target_class_id, target_can_edit)
  ON CONFLICT (user_id, class_id) DO UPDATE
  SET
    can_edit = user_class.can_edit OR EXCLUDED.can_edit,
    updated_at = NOW();

  RETURN QUERY
  SELECT
    matched_user.id,
    matched_user.email,
    matched_user.name,
    target_class_id,
    uc.can_edit
  FROM user_class AS uc
  WHERE uc.user_id = matched_user.id
    AND uc.class_id = target_class_id;
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

INSERT INTO public.user_class (user_id, class_id, can_edit)
SELECT user_id, id, TRUE
FROM public.classes
ON CONFLICT (user_id, class_id) DO UPDATE
SET
  can_edit = TRUE,
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
    OR EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Class owners can add memberships"
  ON user_class FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Class owners can update memberships"
  ON user_class FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Class owners can delete memberships"
  ON user_class FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = user_class.class_id
        AND classes.user_id = auth.uid()
    )
  );

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
  USING (can_edit_class(id))
  WITH CHECK (can_edit_class(id));

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

CREATE POLICY "Users can view notes of their classes"
  ON notes FOR SELECT
  USING (can_view_class(class_id));

CREATE POLICY "Users can create notes for their classes"
  ON notes FOR INSERT
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can update notes of their classes"
  ON notes FOR UPDATE
  USING (can_edit_class(class_id))
  WITH CHECK (can_edit_class(class_id));

CREATE POLICY "Users can delete notes of their classes"
  ON notes FOR DELETE
  USING (can_edit_class(class_id));

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE classes IS 'Classes created by users';
COMMENT ON TABLE users IS 'Application user profiles synced from auth.users';
COMMENT ON TABLE book_sections IS 'Ordered sections inside a class that group books';
COMMENT ON TABLE user_class IS 'Maps users to classes with viewer/editor access';
COMMENT ON TABLE recordings IS 'Video recordings for classes';
COMMENT ON TABLE books IS 'PDF books/documents for classes';
COMMENT ON TABLE notes IS 'Text notes for classes (one per class)';

COMMENT ON COLUMN classes.user_id IS 'UUID of the user who owns this class (matches auth.users.id)';
COMMENT ON COLUMN users.is_teacher IS 'Only teachers can create classes';
COMMENT ON COLUMN book_sections.position IS 'Display order of the section inside the class';
COMMENT ON COLUMN user_class.can_edit IS 'TRUE means the user can edit class content; FALSE means view-only access';
COMMENT ON COLUMN classes.slug IS 'URL-friendly slug for the class';
COMMENT ON COLUMN books.processing_status IS 'Status of PDF processing: pending, processing, completed, or failed';
COMMENT ON COLUMN books.error_message IS 'Error details if processing_status is failed';
COMMENT ON COLUMN books.storage_path IS 'S3 key for the PDF (e.g., books/class-id/file.pdf)';
COMMENT ON COLUMN books.position IS 'Display order of the book inside its section';
COMMENT ON FUNCTION create_class(TEXT, TEXT, TEXT) IS 'Creates a class for the current authenticated teacher user';
COMMENT ON FUNCTION list_class_viewers(UUID) IS 'Returns view-only class members for editors of that class';
COMMENT ON FUNCTION add_user_to_class_by_email(UUID, TEXT, BOOLEAN) IS 'Adds an existing user to a class by email for editors of that class';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 'Database setup complete! All tables, indexes, triggers, and RLS policies have been created.' as status;
