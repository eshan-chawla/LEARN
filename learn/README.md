# Learn - Student Learning Aid Platform

A Next.js application that helps students organize their classes, upload PDFs with AI-powered processing, record lectures, and take notes with autosave functionality.

## Features

- **Class Management**: Create and organize multiple classes with slug-based URLs
- **PDF Upload & Processing**: Upload PDFs that are automatically processed using LlamaParse for text extraction and embeddings generation
- **Notes with Autosave**: Take notes for each class with automatic saving
- **Video Recordings**: Upload and manage lecture recordings
- **Secure Authentication**: Email/password authentication with Supabase
- **Row-Level Security**: All data is isolated per user

## Tech Stack

- **Frontend**: Next.js 16.1.6 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **PDF Processing**: Modal serverless functions with LlamaParse
- **Embeddings**: Sentence Transformers (all-MiniLM-L6-v2)
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
   - `02_SETUP_STORAGE.sql` (storage bucket)

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
```

### 4. Deploy PDF Processing to Modal

Follow the complete guide in `modal/DEPLOYMENT.md`:

```bash
# Install Modal
pip install modal

# Authenticate
modal token new

# Create secrets (see DEPLOYMENT.md for details)
modal secret create llama-cloud-api-key LLAMA_CLOUD_API_KEY=...
modal secret create supabase-credentials SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
modal secret create qdrant-credentials QDRANT_URL=... QDRANT_API_KEY=...

# Deploy
modal deploy modal/pdf_processor.py
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
│   ├── 02_SETUP_STORAGE.sql
│   └── README.md
├── modal/                    # Modal serverless functions
│   ├── pdf_processor.py      # PDF processing function
│   ├── requirements.txt      # Python dependencies
│   └── DEPLOYMENT.md         # Deployment guide
└── utils/                    # Utility functions
    └── supabase/             # Supabase client setup
```

## How It Works

### PDF Processing Flow

1. User uploads PDF via dashboard
2. File is stored in Supabase Storage (`books/{user_id}/{filename}.pdf`)
3. Next.js API calls Modal webhook with book_id, job_id, and storage_path
4. Modal function:
   - Downloads PDF from Supabase Storage
   - Extracts text using LlamaParse (better quality than PyPDF2)
   - Splits text into chunks (500 words with 50 word overlap)
   - Generates embeddings using Sentence Transformers
   - Stores vectors in Qdrant with metadata
   - Updates job status in Supabase (0% → 100%)
5. Client polls for progress updates every 3 seconds

### Authentication

- Email/password authentication via Supabase Auth
- Server-side session management with cookies
- Protected routes with middleware

### Data Security

- Row Level Security (RLS) enabled on all tables
- Users can only access their own data
- Storage files organized by user ID
- Service role key used for Modal to bypass RLS for processing

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
- [LlamaParse Documentation](https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
