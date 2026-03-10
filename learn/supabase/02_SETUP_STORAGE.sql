-- Storage Setup: Create bucket and RLS policies
-- Run this AFTER 01_SETUP_EVERYTHING.sql
-- This sets up the 'books' bucket for PDF storage with proper security

-- ============================================================================
-- CREATE STORAGE BUCKET
-- ============================================================================

-- Create the books bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'books',
  'books',
  false,
  52428800, -- 50 MB in bytes
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STORAGE RLS POLICIES
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload PDFs to their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Service role can read all PDFs" ON storage.objects;

-- Create policy: Users can upload PDFs to their own folder
CREATE POLICY "Users can upload PDFs to their own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'books'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy: Users can view their own PDFs
CREATE POLICY "Users can view their own PDFs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'books'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy: Users can update their own PDFs
CREATE POLICY "Users can update their own PDFs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'books'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy: Users can delete their own PDFs
CREATE POLICY "Users can delete their own PDFs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'books'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy: Service role can read all PDFs (for Lambda function)
CREATE POLICY "Service role can read all PDFs"
ON storage.objects
FOR SELECT
TO service_role
USING (bucket_id = 'books');

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify bucket was created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'books') THEN
    RAISE NOTICE 'SUCCESS: Books bucket created';
  ELSE
    RAISE EXCEPTION 'ERROR: Books bucket was not created';
  END IF;
END $$;

-- Show created policies
SELECT
  'Storage Policy: ' || policyname as policy_info,
  cmd as operation,
  roles as target_roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE '%PDF%'
ORDER BY policyname;

-- Success message
SELECT 'Storage setup complete! Bucket "books" created with RLS policies.' as status;
