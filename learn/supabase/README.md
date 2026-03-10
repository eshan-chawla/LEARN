# Database Setup Scripts

## Quick Start

### Option 1: Fresh Setup (Recommended)

If you're starting fresh or want to reset everything:

1. **Delete everything** (optional, if you have existing data):
   - Open Supabase Dashboard → SQL Editor
   - Copy and paste the entire contents of `00_DELETE_EVERYTHING.sql`
   - Click "Run"

2. **Set up database**:
   - Copy and paste the entire contents of `01_SETUP_EVERYTHING.sql`
   - Click "Run"

3. **Set up storage**:
   - Copy and paste the entire contents of `02_SETUP_STORAGE.sql`
   - Click "Run"

Done! Your database and storage are ready with full RLS security.

### Option 2: Just Setup (No Deletion)

If this is a brand new project:

1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the entire contents of `01_SETUP_EVERYTHING.sql`
3. Click "Run"

## What Gets Created

### Tables (from 01_SETUP_EVERYTHING.sql):
- ✅ `classes` - User's classes
- ✅ `recordings` - Video recordings for classes
- ✅ `books` - PDF documents for classes
- ✅ `notes` - Text notes for classes (one per class)
- ✅ `pdf_processing_jobs` - Tracks PDF processing status

### Storage (from 02_SETUP_STORAGE.sql):
- ✅ `books` bucket - Private storage for PDF files
- ✅ Storage RLS policies - Users can only access their own files
- ✅ Service role access - Modal can read all files for processing

### Security:
- ✅ Row Level Security (RLS) enabled on all tables and storage
- ✅ Users can only see/edit their own data
- ✅ Service role can update PDF processing jobs (for Modal)
- ✅ Files organized by user ID: `books/{user_id}/{filename}.pdf`

### Features:
- ✅ Automatic `updated_at` timestamps
- ✅ Proper indexes for performance
- ✅ Foreign key constraints with CASCADE delete
- ✅ UUIDs for all IDs (works with Supabase Auth)

## Important Notes

### User ID Type
- `user_id` is now **UUID** type (not TEXT)
- Works directly with Supabase Auth: `auth.uid()`
- No more type casting issues

### RLS is Enabled
After running the setup script:
- Users can only see their own classes
- Users can only access recordings/books/notes for their classes
- Each user's data is isolated

### Testing RLS

After setup, test that it works:

```sql
-- Should show RLS is enabled (true)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('classes', 'recordings', 'books', 'notes', 'pdf_processing_jobs');
```

## Troubleshooting

### "relation already exists"
This means tables already exist. Either:
1. Run `00_DELETE_EVERYTHING.sql` first, OR
2. Manually drop the conflicting table

### Can't see any data after setup
This is normal! RLS is working. To see data:
1. Sign in to your app with Supabase Auth
2. Create a new class
3. The class will be tied to your user ID

### Modal can't update jobs
Make sure Modal uses the **service role key**, not the anon key:
```python
# ✅ Correct
supabase = create_client(url, service_role_key)

# ❌ Wrong
supabase = create_client(url, anon_key)
```

## File Structure

```
supabase/
├── 00_DELETE_EVERYTHING.sql  ← Deletes all tables/policies (⚠️ WARNING)
├── 01_SETUP_EVERYTHING.sql   ← Creates database tables with RLS
├── 02_SETUP_STORAGE.sql      ← Creates storage bucket with RLS policies
└── README.md                 ← This file
```

## Migration Order

**Important**: Run the SQL files in this order:

1. `00_DELETE_EVERYTHING.sql` (optional - only if resetting)
2. `01_SETUP_EVERYTHING.sql` (required - database tables)
3. `02_SETUP_STORAGE.sql` (required - storage bucket)

## Migration Notes

If you had old Cognito-based data:
- Old data with TEXT `user_id` values will not work
- You need to either start fresh OR manually migrate user IDs
- New setup uses UUID `user_id` to match Supabase Auth

## What's Next?

After running the setup:

1. ✅ Database is ready
2. ✅ RLS is protecting your data
3. ✅ Ready for Phase 2: File uploads and PDF processing
4. Run `npm run dev` and test the app
5. Create a class and add notes to test autosave

---

**Need to start over?** Just run `00_DELETE_EVERYTHING.sql` then `01_SETUP_EVERYTHING.sql` again.
