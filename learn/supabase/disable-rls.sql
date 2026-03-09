-- Temporarily disable RLS for testing with Cognito authentication
-- Run this in your Supabase SQL Editor if you're having authentication issues

-- Disable RLS on all tables
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recordings DISABLE ROW LEVEL SECURITY;
ALTER TABLE books DISABLE ROW LEVEL SECURITY;
ALTER TABLE notes DISABLE ROW LEVEL SECURITY;

-- Note: This makes all data accessible to anyone with the anon key
-- For production, you should configure Supabase to work with Cognito JWT tokens
-- or implement application-level security checks
