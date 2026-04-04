# Learn - Student Learning Aid Platform

A Next.js application that helps students organize their classes, upload PDFs with AI-powered processing, record lectures, and take private markdown notes.

## Features

- **Class Management**: Create and organize multiple classes with slug-based URLs
- **PDF Upload & Processing**: Upload PDFs that are processed into page-aware embeddings with rich metadata for retrieval
- **Private Markdown Notes**: Take personal markdown notes for each class
- **Video Recordings**: Upload and manage lecture recordings
- **Secure Authentication**: Email/password authentication with Supabase
- **Row-Level Security**: All data is isolated per user

## Tech Stack

- **Frontend**: Next.js 16.1.6 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **Asset Storage**: AWS S3
- **PDF Processing**: Modal serverless functions
- **Embeddings**: Gemini `gemini-embedding-001`
- **Vector Storage**: Qdrant

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase account
- Modal account (for PDF processing)
- Python 3.11+ (for Modal deployment)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd learn
npm install
```

### 2. Database Setup

Follow the complete guide in `supabase/README.md`:

1. Create a Supabase project
2. Run the SQL scripts in order:
   - `00_DELETE_EVERYTHING.sql` (if resetting)
   - `01_SETUP_EVERYTHING.sql` (database tables)

### 3. Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Fill in your credentials:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Modal Configuration (for PDF processing)
MODAL_WEBHOOK_URL=your-modal-webhook-url
MODAL_WEBHOOK_SECRET=your-modal-webhook-secret
MODAL_RETRIEVAL_WEBHOOK_URL=your-modal-retrieval-webhook-url
```

### 4. Deploy PDF Processing to Modal

Follow the complete guide in `modal/DEPLOYMENT.md`:

```bash
# Install Modal
pip install modal

# Authenticate
modal token new

# Create secrets (see DEPLOYMENT.md for details)
modal secret create aws-s3-credentials AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... AWS_S3_RECORDINGS_BUCKET=...
modal secret create gemini-api-key GEMINI_API_KEY=...
modal secret create supabase-credentials SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
modal secret create qdrant-credentials QDRANT_URL=... QDRANT_API_KEY=...
modal secret create modal-webhook-secret MODAL_WEBHOOK_SECRET=...

# Deploy
modal deploy modal/app.py
```

After deployment, copy the webhook URL to your `.env.local`.

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Project Structure

```
learn/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes
│   │   └── process-pdf/      # PDF processing endpoint
│   ├── auth/                 # Authentication pages
│   ├── dashboard/            # Dashboard and class pages
│   └── layout.tsx            # Root layout
├── supabase/                 # Database setup
│   ├── 00_DELETE_EVERYTHING.sql
│   ├── 01_SETUP_EVERYTHING.sql
│   └── README.md
├── modal/                    # Modal serverless functions
│   ├── app.py                # Modal app entrypoint
│   ├── jobs/                 # Background jobs
│   ├── webhooks/             # Webhook entrypoints
│   ├── lib/                  # Shared helpers
│   ├── pdf_processor.py      # Backward-compatible deploy shim
│   ├── requirements.txt      # Python dependencies
│   └── DEPLOYMENT.md         # Deployment guide
└── utils/                    # Utility functions
    └── supabase/             # Supabase client setup
```

## How It Works

### PDF Processing Flow

1. User uploads PDF via dashboard
2. File is stored in S3 (`books/{class_id}/{filename}.pdf`)
3. Next.js API calls the Modal webhook with book metadata and a shared webhook secret
4. Modal function:
   - Downloads the PDF from S3
   - Extracts text page-by-page
   - Splits each page into chunks (500 words with 50 word overlap)
   - Generates embeddings using Gemini `gemini-embedding-001`
   - Stores vectors in a shared Qdrant collection with `class_id`, `content_type`, `file_name`, and `page_number`
   - Updates `books.processing_status` in Supabase

### Retrieval Flow

1. Client calls a Vercel retrieval route with the class ID and search query
2. Next.js verifies the user can access that class
3. Next.js forwards the request to the Modal retrieval webhook
4. Modal generates the query embedding with the same embedding model used for PDF ingestion
5. Modal searches Qdrant with a required `class_id` filter and optional content/source filters
6. Ranked chunks and metadata are returned back through the Next.js API route

### Authentication

- Email/password authentication via Supabase Auth
- Server-side session management with cookies
- Protected routes with middleware

### Data Security

- Row Level Security (RLS) enabled on all tables
- Users can only access their own data
- Storage files organized by class ID
- Service role key used by Modal to update processing status

## Development

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Deployment

### Next.js App

Deploy to Vercel (recommended):

```bash
vercel deploy
```

Or any Node.js hosting platform.

### Modal Function

Already deployed via `modal deploy` (see setup steps above).

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Modal Documentation](https://modal.com/docs)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
