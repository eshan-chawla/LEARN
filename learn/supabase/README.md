# Database Setup Scripts

## Quick Start

Run these SQL scripts in order in your **Supabase Dashboard → SQL Editor**:

| Order | File | Purpose |
|-------|------|---------|
| 0 | `00_DELETE_EVERYTHING.sql` | ⚠️ Optional — wipes all tables for a clean reset |
| 1 | `01_SETUP_EVERYTHING.sql` | ✅ Required — all tables, indexes, RLS policies |
| 2 | `02_ADD_USERS_TABLE_AND_TEACHER_ROLE.sql` | Apply on existing databases to add user profiles + teacher-gated class creation |
| 3 | `03_ADD_USER_CLASS_MEMBERSHIPS.sql` | Apply on existing databases to add class memberships |
| 4 | `04_REPLACE_USER_CLASS_ROLES.sql` | Apply on existing databases to replace boolean edit access with `owner` / `manager` / `student` roles |
| 5 | `05_NOTES_PER_USER_MARKDOWN.sql` | Apply on existing databases to convert shared class notes into per-user markdown notes |

---

## Architecture

```
PDF files   → AWS S3  (books/{classId}/…)
Video files → AWS S3  (videos/{classId}/…)
Metadata    → Supabase Database (users, classes, user_class, recordings, books, notes tables)
```

Both asset types are uploaded directly from the browser to S3 via a pre-signed PUT URL from `/api/upload-asset`. The viewer fetches PDFs via a time-limited S3 pre-signed GET URL from `/api/books/[bookId]`.

---

## What Gets Created

### Tables (`01_SETUP_EVERYTHING.sql`)
- `classes` — Classes created by users
- `users` — App user profiles and roles, synced from `auth.users`
- `recordings` — Video recording metadata (video hosted on S3)
- `books` — PDF metadata (PDF hosted on S3)
- `notes` — Private markdown notes per user per class
- `user_class` — User-to-class memberships with `owner` / `manager` / `student` roles
- `pdf_processing_jobs` — Tracks async PDF processing for Lambda/embeddings

### Security
- Row Level Security (RLS) enabled on all tables
- Users can only read/write their own data
- Only users with `users.is_teacher = true` can create classes
- `user_class.role = 'owner'` can manage roles and transfer ownership
- `user_class.role = 'manager'` can edit class content and add/remove students
- `user_class.role = 'student'` is view-only access
- Service role can update `pdf_processing_jobs` (required by Lambda)

---

## File Structure

```
supabase/
├── 00_DELETE_EVERYTHING.sql   ← ⚠️  Wipes everything (use to reset)
└── 01_SETUP_EVERYTHING.sql    ← ✅  Database tables + RLS policies
```

---

## Troubleshooting

### "relation already exists"
Run `00_DELETE_EVERYTHING.sql` first, then re-run `01_SETUP_EVERYTHING.sql`.

### "new row violates row-level security policy"
The Supabase session JWT is missing. Sign out and sign back in to refresh the session.

### PDF or video upload fails
Both go to AWS S3 via `/api/upload-asset`. Check that these env vars are set in `.env.local`:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (e.g. `us-east-1`)
- `AWS_S3_RECORDINGS_BUCKET` (e.g. `learn-app-recordings-767398053131`)

---

**Need to start over?** Run `00_DELETE_EVERYTHING.sql` then `01_SETUP_EVERYTHING.sql` again.
