-- Learning Aid Platform Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Classes table
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Class recordings table
CREATE TABLE recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  duration INTEGER, -- duration in seconds
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Books/PDFs table
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  file_size INTEGER, -- size in bytes
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notes table
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id) -- One note per class
);

-- Indexes for better query performance
CREATE INDEX idx_classes_user_id ON classes(user_id);
CREATE INDEX idx_recordings_class_id ON recordings(class_id);
CREATE INDEX idx_books_class_id ON books(class_id);
CREATE INDEX idx_notes_class_id ON notes(class_id);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Classes policies
CREATE POLICY "Users can view their own classes"
  ON classes FOR SELECT
  USING (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can insert their own classes"
  ON classes FOR INSERT
  WITH CHECK (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can update their own classes"
  ON classes FOR UPDATE
  USING (user_id = auth.jwt() ->> 'sub')
  WITH CHECK (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can delete their own classes"
  ON classes FOR DELETE
  USING (user_id = auth.jwt() ->> 'sub');

-- Recordings policies
CREATE POLICY "Users can view recordings of their classes"
  ON recordings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can insert recordings to their classes"
  ON recordings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can update recordings of their classes"
  ON recordings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can delete recordings of their classes"
  ON recordings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = recordings.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

-- Books policies
CREATE POLICY "Users can view books of their classes"
  ON books FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can insert books to their classes"
  ON books FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can update books of their classes"
  ON books FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can delete books of their classes"
  ON books FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = books.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

-- Notes policies
CREATE POLICY "Users can view notes of their classes"
  ON notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can insert notes to their classes"
  ON notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can update notes of their classes"
  ON notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "Users can delete notes of their classes"
  ON notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = notes.class_id
      AND classes.user_id = auth.jwt() ->> 'sub'
    )
  );

-- Functions to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at on record updates
CREATE TRIGGER update_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
