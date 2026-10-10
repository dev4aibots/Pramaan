# PRAMAAN v2 (प्रमाण) — Secure, Permission-Aware RAG Engine

> **“Evidence must be earned before it is used.”**  
> Private, verified, role-based retrieval over your documents. Built with Next.js 14, pgvector, in-browser embeddings, and multi-model inference (BYOK Cloud or Edge Local).

---

## ⚡ Core Architecture

- **Layer 1: Identity & Tenant Isolation** — Scoped by organization with hierarchical RBAC (`owner`, `admin`, `manager`, `member`, `viewer`) and Subject IDs for row-level isolation.
- **Layer 2: Prompt-Injection Firewall** — Active input inspection quarantining prompt injection patterns, role-hijacking, and invisible Unicode exploits.
- **Layer 3: Permission-Aware Hybrid Retrieval** — RBAC and Subject ID filters enforced in SQL before vector ranking (Reciprocal Rank Fusion with pgvector HNSW + full-text search).
- **Layer 4: Context Sanitization & PII Shield** — On-the-fly masking of sensitive credentials, phone numbers, emails, and Aadhaar/SSN IDs before reaching the LLM context.
- **Layer 5: Output Verification & Audit Chain** — Canary leak detection, groundedness verification, citation matching `[S#]`, and tamper-evident SHA-256 hash-chained audit logging.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create `.env.local` (or copy from `.env.example`):
```bash
DATABASE_URL=postgres://user:password@host:5432/pramaan?sslmode=require
AUTH_SECRET=your-32-char-random-secret
ENCRYPTION_KEY=your-32-byte-base64-key
```

### 3. Run Migrations
Apply the PostgreSQL schema:
```bash
npm run db:migrate
```

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the application.

---

## 🤖 Supported Inference Engines
- **Cloud BYOK**: OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral, DeepSeek, Together AI, or custom OpenAI-compatible endpoints.
- **Browser WebLLM**: Run Llama 3.2, Qwen 2.5, and Phi 3.5 directly in the browser via WebGPU with 0 token cost.
- **Local Ollama**: Connect to local Ollama daemon (`http://localhost:11434`) with one-click catalog pull.
- **LM Studio**: Connect to LM Studio local server (`http://localhost:1234/v1`).
