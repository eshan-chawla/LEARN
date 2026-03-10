# Database Setup Scripts

## Quick Start

Run these SQL scripts in order in your **Supabase Dashboard → SQL Editor**:

| Order | File | Purpose |
|-------|------|---------|
| 0 | `00_DELETE_EVERYTHING.sql` | ⚠️ Optional — wipes all tables for a clean reset |
| 1 | `01_SETUP_EVERYTHING.sql` | ✅ Required — all tables, indexes, RLS policies |

That's it. Both videos **and** PDFs are stored in **AWS S3** — no Supabase Storage setup required.

> `02_SETUP_STORAGE.sql` is kept for reference but is no longer used.

---

## Architecture

```
PDF files   → AWS S3  (books/{classId}/…)
Video files → AWS S3  (videos/{classId}/…)
Metadata    → Supabase Database (classes, recordings, books, notes tables)
```

Both asset types are uploaded directly from the browser to S3 via a pre-signed PUT URL from `/api/upload-asset`. The viewer fetches PDFs via a time-limited S3 pre-signed GET URL from `/api/books/[bookId]`.

---

## What Gets Created

### Tables (`01_SETUP_EVERYTHING.sql`)
- `classes` — Classes created by users
- `recordings` — Video recording metadata (video hosted on S3)
- `books` — PDF metadata (PDF hosted on S3)
- `notes` — Text notes per class (autosaved)
- `pdf_processing_jobs` — Tracks async PDF processing for Lambda/embeddings

### Security
- Row Level Security (RLS) enabled on all tables
- Users can only read/write their own data
- Service role can update `pdf_processing_jobs` (required by Lambda)

---

## File Structure

```
supabase/
├── 00_DELETE_EVERYTHING.sql   ← ⚠️  Wipes everything (use to reset)
├── 01_SETUP_EVERYTHING.sql    ← ✅  Database tables + RLS policies
├── 02_SETUP_STORAGE.sql       ← 🗄️  Legacy (Supabase Storage no longer used)
└── README.md                  ← This file
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
