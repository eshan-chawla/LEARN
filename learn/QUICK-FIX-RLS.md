# Quick Fix: Disable Row Level Security (RLS)

## Problem
You're seeing an error: "Error creating class: {}" when trying to create a class. This is because Supabase's Row Level Security (RLS) policies expect Supabase authentication, but we're using AWS Cognito.

## Quick Solution: Disable RLS

**Important:** This solution is for development/testing only. For production, you should properly configure Supabase to work with Cognito JWT tokens.

### Steps:

1. Go to your Supabase project dashboard at https://supabase.com
2. Navigate to **SQL Editor** on the left sidebar
3. Click **New Query**
4. Copy and paste the following SQL:

```sql
-- Disable RLS on all tables
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recordings DISABLE ROW LEVEL SECURITY;
ALTER TABLE books DISABLE ROW LEVEL SECURITY;
ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
```

5. Click **Run** to execute the SQL

### Alternative: Drop and Recreate Without RLS

If you want to start fresh without RLS policies:

1. Go to **SQL Editor** in Supabase
2. Run this to drop all policies:

```sql
-- Drop all RLS policies
DROP POLICY IF EXISTS "Users can view their own classes" ON classes;
DROP POLICY IF EXISTS "Users can insert their own classes" ON classes;
DROP POLICY IF EXISTS "Users can update their own classes" ON classes;
DROP POLICY IF EXISTS "Users can delete their own classes" ON classes;

DROP POLICY IF EXISTS "Users can view recordings of their classes" ON recordings;
DROP POLICY IF EXISTS "Users can insert recordings to their classes" ON recordings;
DROP POLICY IF EXISTS "Users can update recordings of their classes" ON recordings;
DROP POLICY IF EXISTS "Users can delete recordings of their classes" ON recordings;

DROP POLICY IF EXISTS "Users can view books of their classes" ON books;
DROP POLICY IF EXISTS "Users can insert books to their classes" ON books;
DROP POLICY IF EXISTS "Users can update books of their classes" ON books;
DROP POLICY IF EXISTS "Users can delete books of their classes" ON books;

DROP POLICY IF EXISTS "Users can view notes of their classes" ON notes;
DROP POLICY IF EXISTS "Users can insert notes to their classes" ON notes;
DROP POLICY IF EXISTS "Users can update notes of their classes" ON notes;
DROP POLICY IF EXISTS "Users can delete notes of their classes" ON notes;

-- Disable RLS
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recordings DISABLE ROW LEVEL SECURITY;
ALTER TABLE books DISABLE ROW LEVEL SECURITY;
ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
```

## After Running the SQL

1. Restart your Next.js development server:
   ```bash
   # Press Ctrl+C to stop the server, then:
   npm run dev
   ```

2. Try creating a class again - it should work now!

## For Production: Proper Cognito + Supabase Integration

For production use, you should configure Supabase to validate Cognito JWT tokens. This requires:

1. Setting up custom JWT validation in Supabase
2. Configuring the JWT secret from Cognito
3. Updating RLS policies to use Cognito's user ID format

This is more complex but provides proper security. For now, disabling RLS allows you to develop and test the application.

## Security Note

⚠️ **Warning:** With RLS disabled, any user with your Supabase anon key can access all data in these tables. This is acceptable for development but should NOT be used in production without additional security measures at the application level.

For production, consider:
- Implementing application-level access control
- Using Supabase's custom JWT validation
- Or migrating authentication to Supabase Auth
