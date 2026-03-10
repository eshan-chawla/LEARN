-- Complete Database Setup with RLS
-- Run this script in Supabase SQL Editor to set up everything from scratch
-- This creates all tables, indexes, triggers, and RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Classes table
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
  title TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  file_size INTEGER,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  storage_path TEXT,
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

-- PDF Processing Jobs table
CREATE TABLE pdf_processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_message TEXT,
  chunks_processed INTEGER DEFAULT 0,
  total_chunks INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_classes_user_id ON classes(user_id);
CREATE INDEX idx_classes_slug ON classes(slug);
CREATE INDEX idx_recordings_class_id ON recordings(class_id);
CREATE INDEX idx_books_class_id ON books(class_id);
CREATE INDEX idx_notes_class_id ON notes(class_id);
CREATE INDEX idx_pdf_jobs_book_id ON pdf_processing_jobs(book_id);
CREATE INDEX idx_pdf_jobs_status ON pdf_processing_jobs(status);
CREATE INDEX idx_pdf_jobs_created_at ON pdf_processing_jobs(created_at DESC);

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

-- Triggers for each table
CREATE TRIGGER trigger_update_classes_updated_at
  BEFORE UPDATE ON classes
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

CREATE TRIGGER trigger_update_pdf_jobs_updated_at
  BEFORE UPDATE ON pdf_processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_processing_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: CLASSES
-- ============================================================================

CREATE POLICY "Users can view their own classes"
  ON classes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own classes"
  ON classes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own classes"
  ON classes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own classes"
  ON classes FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES: RECORDINGS
-- ============================================================================

CREATE POLICY "Users can view recordings of their classes"
  ON recordings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create recordings for their classes"
  ON recordings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update recordings of their classes"
  ON recordings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete recordings of their classes"
  ON recordings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES: BOOKS
-- ============================================================================

CREATE POLICY "Users can view books of their classes"
  ON books FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create books for their classes"
  ON books FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update books of their classes"
  ON books FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete books of their classes"
  ON books FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES: NOTES
-- ============================================================================

CREATE POLICY "Users can view notes of their classes"
  ON notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create notes for their classes"
  ON notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update notes of their classes"
  ON notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete notes of their classes"
  ON notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES: PDF PROCESSING JOBS
-- ============================================================================

CREATE POLICY "Users can view their own PDF processing jobs"
  ON pdf_processing_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM books
      JOIN classes ON classes.id = books.class_id
      WHERE books.id = pdf_processing_jobs.book_id
      AND classes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create PDF processing jobs for their books"
  ON pdf_processing_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM books
      JOIN classes ON classes.id = books.class_id
      WHERE books.id = pdf_processing_jobs.book_id
      AND classes.user_id = auth.uid()
    )
  );

-- Allow service role (Lambda) to update and delete jobs
CREATE POLICY "Service role can update PDF processing jobs"
  ON pdf_processing_jobs FOR UPDATE
  USING (true);

CREATE POLICY "Service role can delete PDF processing jobs"
  ON pdf_processing_jobs FOR DELETE
  USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE classes IS 'Classes created by users';
COMMENT ON TABLE recordings IS 'Video recordings for classes';
COMMENT ON TABLE books IS 'PDF books/documents for classes';
COMMENT ON TABLE notes IS 'Text notes for classes (one per class)';
COMMENT ON TABLE pdf_processing_jobs IS 'Tracks async PDF processing jobs for embedding generation';

COMMENT ON COLUMN classes.user_id IS 'UUID of the user who owns this class (matches auth.users.id)';
COMMENT ON COLUMN classes.slug IS 'URL-friendly slug for the class';
COMMENT ON COLUMN books.processing_status IS 'Status of PDF processing: pending, processing, completed, or failed';
COMMENT ON COLUMN books.storage_path IS 'Path to the PDF file in Supabase Storage (e.g., books/user-id/file.pdf)';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 'Database setup complete! All tables, indexes, triggers, and RLS policies have been created.' as status;
