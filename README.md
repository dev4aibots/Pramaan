# PRAMAAN (प्रमाण) — Secure Multi-Modal RAG System with Access Control

> **"Evidence must be earned before it is used."**

PRAMAAN is a **zero-trust security architecture for Retrieval-Augmented Generation**. It ensures an AI only uses trusted documents, only retrieves data the user is authorized to see, only answers from available evidence, and never leaks sensitive information.

Built for **PS-01** · **Code Carnival 3.0** · Team **Madmax**

---

## The Problem

Enterprise RAG pipelines trust too much. Once retrieved content reaches the model, it is treated as trusted — but:

1. **Poisoned documents** — a PDF with hidden instructions hijacks model behavior (indirect prompt injection)
2. **Broken authorization** — the vector DB returns what is *relevant*, not what the user may *see*
3. **Confident hallucinations** — the LLM fills evidence gaps with invented facts
4. **Egress leaks** — phone numbers, IDs, and secrets flow out in answers and logs

**Relevance is not permission. Fluency is not truth.**

## The Solution — Five Security Checkpoints

```
UPLOAD → SCAN → AUTHORIZE → PROVE → SANITIZE → AUDIT → ANSWER
```

| # | Layer | What it does |
|---|-------|--------------|
| 1 | **Ingestion Security Scanner** | Inspects every document before indexing — hidden instructions, Unicode anomalies, suspicious patterns → quarantined, never embedded |
| 2 | **Retrieval-Time Authorization** | Identity + document policies enforced **inside the vector query** (pgvector filtered HNSW). The database never sees data the user cannot access |
| 3 | **Evidence-Grounded Synthesis** | Every claim chained to authorized evidence with exact citations. No proof → `insufficient_evidence`, never invention |
| 4 | **Egress Sanitizer** | Scans the outgoing response — PII redacted before delivery |
| 5 | **Tamper-Evident Audit Ledger** | Every security event recorded with hash-chained integrity |

## Key Features

- **Multi-modal ingestion** — PDFs, images (OCR), spreadsheets, text, video keyframes; browser-side extraction keeps raw files on-device
- **In-browser embeddings** (Transformers.js) — documents are embedded locally; only vectors cross the network
- **Four inference engines, auto-detected** — 🌐 WebLLM (in-browser, zero token cost) · 🦙 Ollama (local) · 🧪 LM Studio (local) · ☁️ BYOK cloud (OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral, DeepSeek, Together)
- **Platform auto-detection** — the app detects Vercel / Docker / local / air-gapped and configures itself; every unavailable feature explains *why*
- **Row/document-level access control** — RBAC roles (`owner`, `admin`, `manager`, `member`, `viewer`) + per-subject isolation
- **Exact citations** — claim → verbatim quote → chunk → document → ACL snapshot

## Quick Start

```bash
npm install
cp .env.example .env.local   # set AUTH_SECRET + ENCRYPTION_KEY
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No external database needed — PGlite (embedded Postgres + pgvector) starts with the app.

## Deploy

**Vercel (one click):** import the repo — the app auto-detects the serverless environment. Set `AUTH_SECRET` and `ENCRYPTION_KEY` in project env vars.

**Docker / local:** `npm run build && npm start`. For local LLMs, run Ollama (`ollama serve`) or LM Studio alongside.

## Project Structure

```
src/
├── app/                    # Pages + API routes
│   ├── api/                # auth, chat, retrieve, verify, documents, keys, platform, audit…
│   ├── app/                # Main application shell
│   └── login/              # Authentication
├── components/             # Chat, Knowledge, Models, Team, Audit, Connectors
└── lib/
    ├── client/             # Browser: embeddings, extraction, engine detection
    ├── security/           # guard (injection), redact (PII), verify (grounding)
    ├── db.ts               # PGlite + pgvector
    ├── retrieval.ts        # Permission-aware hybrid retrieval
    └── pipeline.ts         # The 5-layer pipeline
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App | Next.js 14 + React + Tailwind CSS |
| Database | PGlite — embedded Postgres + pgvector (filtered HNSW) |
| Embeddings | Transformers.js (in-browser, WebGPU/WASM) |
| Local LLMs | WebLLM · Ollama · LM Studio |
| Cloud LLMs | BYOK — OpenAI-compatible endpoints |
| Auth | jose (JWT sessions) + bcryptjs |

## Roadmap

- **Phase 1** ✅ Trusted core: 5-layer pipeline, RBAC, PII shield, audit ledger
- **Phase 2** → Cryptographically verifiable audit trails (Merkle-tree)
- **Phase 3** → Air-gapped / on-premise enterprise deployments
- **Phase 4** → Continuous synthetic red-teaming

## Credits

**Team Madmax** — Code Carnival 3.0 · Problem Statement PS-01
- **Team Leader:** Nikhil Rathod
- **Team ID:** JFYP
- **Institution:** Atmiya University — Developers Students Club (ADSC)

**Open-source foundations** — PRAMAAN assembles best-in-class open source instead of reinventing:
- [Next.js](https://nextjs.org) (Vercel) — application framework
- [PGlite](https://github.com/electric-sql/pglite) (Electric SQL) — embedded Postgres
- [pgvector](https://github.com/pgvector/pgvector) — vector search
- [Transformers.js](https://huggingface.co/docs/transformers.js) (Hugging Face) — in-browser ML
- [WebLLM](https://github.com/mlc-ai/web-llm) (MLC AI) — in-browser inference
- [Ollama](https://ollama.com) — local LLM serving
- [pdfjs](https://mozilla.github.io/pdf.js/) (Mozilla, via unpdf) — PDF extraction
- [Tailwind CSS](https://tailwindcss.com) · [Lucide](https://lucide.dev) — interface

**Security doctrine** informed by OWASP Top 10 for LLM Applications (LLM01, LLM02, LLM06, LLM09).

---

*PRAMAAN doesn't make the LLM trustworthy. It makes everything around the LLM verifiable.*
