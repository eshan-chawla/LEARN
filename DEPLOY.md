# Deploying and running LEARN

This is the complete guide from empty accounts to a working deployment, plus how to run the app, tests and experiments locally. Follow the sections in order the first time. Total time is about 1–1.5 hours.

```
Browser ──► Vercel (Next.js app + /api routes) ──► Supabase (Postgres + Auth, RLS)
   │                    │        └──────────────► Gemini / GLM (chat models)
   │ presigned PUT/GET  └──► Modal webhooks ──► S3 (download) → chunk → Gemini embeddings → Qdrant
   └──────────────► AWS S3                  └──► Qdrant search (retrieval) ◄── /api/tutor, Ask AI
```

> **Secrets.** Every key below goes only into `learn/.env.local`, `qdrant/.env`, Modal secrets, or Vercel environment variables. All of these are git-ignored or stored in the provider. Never commit them or paste them into chat or issues. If a key from the old deployment still exists, **revoke it** and create a new one.

---

## 1. Accounts and keys you need

| # | Service | Free tier? | What you get | Where it goes |
|---|---|---|---|---|
| 1 | **Supabase** (supabase.com) | yes | `Project URL`, `anon` key, `service_role` key (Project Settings → API) | `.env.local`, Vercel, Modal secret `supabase-credentials` |
| 2 | **AWS** (S3 + IAM) | 5 GB for 12 months | bucket name, region, IAM access key id and secret | `.env.local`, Vercel, Modal secret `aws-s3-credentials` |
| 3 | **Qdrant Cloud** (cloud.qdrant.io) | 1 GB cluster | cluster URL, API key | `qdrant/.env`, `.env.local`, Vercel, Modal secret `qdrant-credentials` |
| 4 | **Google AI Studio** (aistudio.google.com) | yes (rate-limited) | `GEMINI_API_KEY`, used for embeddings and chat | `.env.local`, Vercel, Modal secret `gemini-api-key` |
| 5 | **Modal** (modal.com) | monthly credits | CLI token (`modal token new`), 3 webhook URLs after deploy | URLs → `.env.local`, Vercel |
| 6 | **Vercel** (vercel.com) | Hobby | project connected to the GitHub repo | — |
| 7 | **GLM** (Z.ai or your GLM provider) | your credits | API key, model id, base URL | `.env.local`, Vercel (optional: enables the "GLM Flash" model) |
| 8 | Webhook secret | — | random string: `openssl rand -hex 32` | `.env.local`, Vercel, Modal secret `modal-webhook-secret` |

---

## 2. Environment files

### `learn/.env.local` (the web app, eval scripts and seed script)

```bash
cd learn && cp .env.local.example .env.local
```

| Variable | Value | Needed for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | app (also at **build time**) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase `anon` key | app (also at build time) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` key, **server only** | upload routes, `npm run graph:seed` |
| `GEMINI_API_KEY` | Google AI Studio key | Ask AI, tutor, eval |
| `ASK_AI_CHAT_MODEL` | `gemini-2.5-flash-lite` (default) / `gemini-2.5-flash` / `gemini-2.5-pro` / `glm-flash` | default chat model |
| `GEMINI_CHAT_MODEL` | optional legacy fallback | — |
| `GLM_API_KEY`, `GLM_MODEL_ID`, `GLM_BASE_URL` | GLM credentials; base URL defaults to `https://api.z.ai/api/paas/v4` | the `glm-flash` model only |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_RECORDINGS_BUCKET` | IAM user + bucket from §3.2 | PDF/video upload and viewing |
| `MODAL_WEBHOOK_URL` | `https://<workspace>--pdf-processor-process-pdf-webhook.modal.run` | PDF processing |
| `MODAL_VIDEO_WEBHOOK_URL` | `https://<workspace>--pdf-processor-process-video-webhook.modal.run` | video processing |
| `MODAL_RETRIEVAL_WEBHOOK_URL` | `https://<workspace>--pdf-processor-search-content-webhook.modal.run` | retrieval (Ask AI, tutor, eval) |
| `MODAL_WEBHOOK_SECRET` | the random string from §1 #8 | all Modal calls |
| `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant cluster | app (structure queries) |
| `TUTOR_RAG_MODE` | `dense` (switch to `hybrid` after Joao's hybrid retrieval is deployed) | `/api/tutor` |
| `EVAL_CLASS_ID` | UUID of the class holding the lecture PDFs (§3.7) | eval scripts only |
| `MODAL_RETRIEVAL_TIMEOUT_MS`, `ASK_AI_TIMEOUT_MS` | optional; defaults are 15000 and 25000 | per-call timeouts that keep one slow call inside the 60 s function limit |

### `qdrant/.env` (collection setup script)

```bash
cp qdrant/.env.example qdrant/.env   # QDRANT_URL, QDRANT_API_KEY
```

### Modal secrets (5, created with the CLI in §3.4)

| Secret name | Keys |
|---|---|
| `aws-s3-credentials` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_RECORDINGS_BUCKET` |
| `supabase-credentials` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the `service_role` key) |
| `qdrant-credentials` | `QDRANT_URL`, `QDRANT_API_KEY` |
| `gemini-api-key` | `GEMINI_API_KEY` |
| `modal-webhook-secret` | `MODAL_WEBHOOK_SECRET` |

### Vercel

Add **every** variable from `learn/.env.local` except `EVAL_CLASS_ID` (Project → Settings → Environment Variables, for Production and Preview).

---

## 3. Deploy, step by step

### 3.1 Supabase (database + auth)
1. Create a project (free plan) and pick a region close to you.
2. **SQL Editor:** run `learn/supabase/01_SETUP_EVERYTHING.sql`, then `learn/supabase/06_LEARNER_STATE.sql`. On a fresh database, scripts 02–05 are **not** needed, because they only upgrade older databases.
3. **Authentication → Providers:** enable Email.
4. **Authentication → URL Configuration:** set Site URL to `http://localhost:3000` for now. You'll add the Vercel URL in 3.5.
5. Copy the Project URL, `anon` key and `service_role` key into `.env.local`.
6. Free projects **pause after about 7 days without activity**. Open the dashboard and unpause before demos and grading.

### 3.2 AWS S3 (files)
1. Create a bucket, e.g. `learn-course-assets-<random>`, with **Block all public access ON**.
2. Bucket → Permissions → **CORS**. Browsers upload directly with presigned URLs, so uploads fail without this:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://<your-app>.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
3. IAM → Users → create `learn-app` with **no console access**. Attach this inline policy, then create an access key:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::<bucket-name>/*"
       }
     ]
   }
   ```

### 3.3 Qdrant Cloud (vectors)
1. Create a free cluster and an API key.
2. Fill `qdrant/.env`, then:
   ```bash
   python3 qdrant/create_collection.py
   ```
   Expected: the collection `class_content_embeddings` (768-d, cosine) with payload indexes `class_id`, `content_type`, `source_id`, `page_number`.
3. Create a **second** API key for Joao, so his development key can be revoked separately.

### 3.4 Modal (ingestion + retrieval webhooks)
```bash
pip install modal
modal token new
modal secret create aws-s3-credentials AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 AWS_S3_RECORDINGS_BUCKET=...
modal secret create supabase-credentials SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_KEY=...
modal secret create qdrant-credentials QDRANT_URL=... QDRANT_API_KEY=...
modal secret create gemini-api-key GEMINI_API_KEY=...
modal secret create modal-webhook-secret MODAL_WEBHOOK_SECRET=...
modal deploy modal/app.py
```
- The deploy prints 3 webhook URLs (`...process-pdf-webhook`, `...process-video-webhook`, `...search-content-webhook`). Copy them into `.env.local`.
- Invite Joao to the workspace: Modal dashboard → Settings → Members.

### 3.5 Vercel (frontend + API)
1. New Project → import `eshan-chawla/LEARN` → **Root Directory: `learn`** (the framework is auto-detected as Next.js).
2. Add the environment variables (§2), then click Deploy.
3. Add the Vercel URL to **Supabase** Auth URL Configuration (Site URL + Redirect URLs) and to the **S3 CORS** `AllowedOrigins`.
4. The tutor route sets `maxDuration = 60`. If tutor replies time out on the Hobby plan, check Project → Settings → Functions.

### 3.6 GLM check (optional, before using `glm-flash`)
```bash
curl -s "$GLM_BASE_URL/chat/completions" -H "Authorization: Bearer $GLM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"'"$GLM_MODEL_ID"'","messages":[{"role":"user","content":"Reply with {\"ok\":true}"}],"response_format":{"type":"json_object"}}'
```
- Expected: `choices[0].message.content` is JSON.
- If `response_format` is rejected, note it. The tutor's parsers still accept fenced or plain JSON.

### 3.7 First run: class, lectures, concept graph
1. Open the app, sign up, then in the Supabase SQL Editor run:
   ```sql
   update public.users set is_teacher = true where email = '<your sign-up email>';
   ```
2. Create the class (e.g. "Deep Learning") and upload the lecture PDFs.
3. Wait until each book shows **completed**: the `books.processing_status` column, or the badge in the UI.
4. Copy the class UUID (`select id, name from classes;`) into `EVAL_CLASS_ID`.
5. Seed the concept graph for the class:
   ```bash
   cd learn && npm run graph:seed -- --class <class-uuid>
   ```
   Expected: `Seeded concept graph v1 (31 concepts) for class <uuid>`.
6. Smoke test:
   - **Ask AI** on a book should give an answer with an `[n]` citation that opens the right page.
   - **Class → Tutor**: answer a check question wrongly. The concept should turn amber or red on the mastery map, and "Why this response" should show the decision.

---

## 4. Run locally

```bash
cd learn
npm ci
npm run dev                    # http://localhost:3000 (needs .env.local)
npm test                       # unit tests (no network, no keys needed)
npx tsc --noEmit && npx eslint lib app eval scripts components
```

Local development uses the same Supabase, S3, Qdrant and Modal services as production. There is no local emulator.

## 5. Experiments

```bash
cd learn
npm run graph:build                                   # merge data/concept_graph parts → dl_course.json
npm run eval:single -- --config A1 --limit 10         # pilot (A0 | A1 | A2 | A3)
npm run eval:single -- --config A0                    # full benchmark, one config at a time
```

- Outputs go to `results/single_turn/<run-id>.jsonl` and `.summary.json`. Commit them; the paper's numbers must come from these files.
- The multi-turn memory experiments (`eval/run-trajectories.ts`) and the plots (`analysis/`) are Joao's items. See `docs/WORKPLAN.md`.

## 6. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `npm run build` fails with "Missing Supabase environment variables" | the `NEXT_PUBLIC_SUPABASE_*` variables are not set at build time (Vercel env or `.env.local`) |
| Upload fails in the browser with a CORS error | the S3 CORS `AllowedOrigins` is missing your domain |
| Books stuck in `processing` | open Modal → app `pdf-processor` → logs; usually a wrong Modal secret name or value |
| Tutor returns 404 "No concept graph for this class" | run `npm run graph:seed -- --class <uuid>` |
| Tutor returns 409 | two tabs sent at once; resend |
| Retrieval step fails with "Hybrid retrieval was requested but the webhook did not serve it" | `TUTOR_RAG_MODE=hybrid` or `--config A2/A3` used before hybrid retrieval (J1) is deployed. Use `dense` until then |
| Every request fails after a week of inactivity | the Supabase project is paused; restore it in the dashboard |
