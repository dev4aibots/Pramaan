# PRAMAAN v2 — Architecture

> Status legend: **[LIVE]** = verified in code on disk (`/tmp/pramaan-v2/src`) · **[MISSING]** = in spec/mission but not in `src` · **[PLANNED]** = designed here, not yet specced.
> Source of truth for the original design: `/tmp/pramaan-v2/USE-THIS.TXT` (2311 lines; the author warns it was never built or run — this document reports what the code *actually* does).

## 1. System diagram

```mermaid
flowchart TB
    subgraph BROWSER["BROWSER (user's device)"]
        direction TB
        READ["File read<br/>extract.ts<br/>PDF/DOCX/XLSX/CSV/JSON/HTML/TXT"] --> CHUNK["Chunk<br/>chunk.ts<br/>~900 chars, 150 overlap"]
        CHUNK --> EMBED["Embeddings<br/>embed.ts · Transformers.js v3<br/>Xenova/bge-small-en-v1.5 → 384-d<br/>WebGPU → WASM fallback"]
        DETECT["detect.ts [MISSING]<br/>probe localhost:11434, localhost:1234,<br/>WebGPU, secure context"]
        ENGINES["engines.ts [LIVE]<br/>WebLLM CreateMLCEngine<br/>Ollama /api/chat<br/>LM Studio /v1/chat/completions"]
        DRIVE["drive.ts [LIVE]<br/>Google Drive GIS token flow"]
    end

    subgraph NEXT["Next.js 14 (server)"]
        direction TB
        MW["middleware.ts [LIVE]<br/>cookie gate on /app/*"]
        API["API routes [LIVE]<br/>15 routes, handler() wrapper"]
        PIPE["5-layer pipeline [LIVE]<br/>pipeline.ts prepare()<br/>L1 identity → L2 firewall →<br/>L3 retrieval → L4 sanitize"]
        SEC["security/ [LIVE]<br/>guard.ts · redact.ts · verify.ts"]
        KV["Key vault [LIVE]<br/>crypto.ts AES-256-GCM<br/>keys never leave server"]
        AUDIT["Audit [LIVE]<br/>hash-chained audit_log<br/>rateLimit via audit_log"]
    end

    subgraph DB["DATA"]
        direction TB
        PGLITE["PGlite [LIVE]<br/>embedded Postgres + pgvector<br/>zero-setup, .pgdata/"]
        EXT["External Postgres [LIVE]<br/>via DATABASE_URL<br/>Neon / Supabase / docker"]
    end

    subgraph LOCAL["Local engines (user's machine)"]
        OLLAMA["Ollama<br/>localhost:11434"]
        LMS["LM Studio<br/>localhost:1234/v1"]
    end

    subgraph CLOUD["Cloud BYOK providers"]
        PROV["OpenAI · Anthropic · Gemini · Groq<br/>OpenRouter · NVIDIA · Mistral<br/>DeepSeek · Together · custom https"]
    end

    %% Ingest path
    READ -.->|"(a) ingest"| EMBED
    EMBED -->|"POST /api/documents<br/>batches ≤ 32 chunks<br/>(4.5 MB Vercel limit)"| API
    DRIVE -.->|"download → extract.ts"| READ

    %% Query path: cloud BYOK — all 5 layers
    ENGINES -.->|"(b) cloud path"| API
    API -->|"POST /api/chat<br/>{query, embedding, keyId}"| PIPE
    PIPE --> SEC
    API -->|"decrypt key server-side"| KV
    KV -->|"callLLM"| PROV
    PROV -->|"raw answer"| SEC
    SEC -->|"L5 verifyAnswer<br/>canary + grounding"| API

    %% Query path: local models — layers 1-4, then 5
    API -->|"POST /api/retrieve<br/>layers 1–4 only"| PIPE
    PIPE -->|"messages + canary<br/>stored in pending_answers"| API
    API -->|"returns messages"| ENGINES
    ENGINES -->|"browser → localhost LLM"| OLLAMA
    ENGINES -->|"browser → localhost LLM"| LMS
    ENGINES -->|"in-browser"| ENGINES
    ENGINES -->|"POST /api/verify<br/>{auditId, answer}<br/>single-use row delete"| SEC

    API <-->|"sql tagged templates"| DB
    PGLITE -.->|"or"| EXT
    DETECT -.->|"GET /api/platform [MISSING]"| API
    MW --> API
    API --> AUDIT
```

**The two query paths (why the split exists):** Vercel serverless can **never** reach `localhost:11434` / `localhost:1234` — those live on the user's machine, not in the datacenter. So for local models the server does everything it can (layers 1–4: identity, firewall, ACL-bound retrieval, sanitization) and hands *messages + a canary* to the browser; the browser runs the LLM locally and posts the raw answer back to `/api/verify` for layer 5. Cloud BYOK goes through `/api/chat` for all 5 layers in one round trip.

## 2. Component map

Owner squads per `docs/BLACKBOARD_V2.md` remap.

### API routes (`src/app/api/`) → ENGINE-1, except BYOK keys (ENGINE-2)

| Route | Methods | Responsibility | Owner | Status |
|---|---|---|---|---|
| `auth/signup` | POST | Create user + personal org + owner membership in one tx; set jose session cookie; audit `signup` | ENGINE-1 | [LIVE] |
| `auth/login` | POST | bcrypt compare (dummy-hash for constant-ish time); set session cookie | ENGINE-1 | [LIVE] |
| `auth/logout` | POST | Clear session cookie | ENGINE-1 | [LIVE] |
| `me` | GET | Session ctx + org list + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ENGINE-1 | [LIVE] |
| `orgs` | POST, PUT | Create team org (become owner); switch `active_org_id` | ENGINE-1 | [LIVE] |
| `orgs/join` | POST | Consume invite code (row-locked, usage-capped, expiry-checked) → membership | ENGINE-1 | [LIVE] |
| `invites` | POST | Admin+ creates invite (`PRM-…` code, role, subject_ref, max_uses); owner-only for admin invites | ENGINE-1 | [LIVE] |
| `members` | GET, PATCH, DELETE | List (manager+ sees all, others see self); change role/subject_ref; remove member; owner is immutable | ENGINE-1 | [LIVE] |
| `documents` | GET, POST, DELETE | ACL-filtered list; batch chunk insert with per-chunk injection scan + quarantine; owner/admin delete | ENGINE-1 | [LIVE] |
| `keys` | GET, POST, DELETE | BYOK vault: store AES-256-GCM-encrypted keys; GET never returns secrets; only owner can delete own key | ENGINE-2 | [LIVE] |
| `chat` | POST | **Cloud path — all 5 layers.** rateLimit → `prepare()` → decrypt key → `callLLM` → `verifyAnswer` → audit `chat` | ENGINE-1 | [LIVE] |
| `retrieve` | POST | **Local path — layers 1–4.** rateLimit → `prepare()` → store `pending_answers` (single-use, 1h TTL) → return messages | ENGINE-1 | [LIVE] |
| `verify` | POST | **Local path — layer 5.** Single-use `DELETE … RETURNING` of pending row → `verifyAnswer` (canary) → audit `verify` | ENGINE-1 | [LIVE] |
| `connectors/postgres` | POST | Read-only SQL import (SELECT/WITH only, 15s statement timeout, 5000-row cap); browser embeds rows afterwards | ENGINE-1 | [LIVE] |
| `audit` | GET | Hash-chained log; admins see org-wide, others see own | ENGINE-1 | [LIVE] |
| `platform` | GET | Resolved platform profile + per-feature `{status, reason}` | ENGINE-2 | [MISSING] |

### Server lib (`src/lib/`) → ENGINE-1, except as noted

| Module | Responsibility | Owner | Status |
|---|---|---|---|
| `db.ts` | **Dual-mode SQL**: external `DATABASE_URL` (heuristic) → `postgres` package; else embedded **PGlite** + pgvector with schema auto-init. Exports one `sql` tagged-template surface for both | ENGINE-1 | [LIVE] |
| `http.ts` | `handler()` wrapper: **CSRF origin-vs-host check** on non-GET, zod → 400, HttpError mapping, 500 masking | ENGINE-1 | [LIVE] |
| `auth.ts` | jose HS256 sessions (`pramaan_session`, httpOnly, 7d); `requireCtx()` (active-org resolution); role ranks `viewer…owner` | ENGINE-1 | [LIVE] |
| `crypto.ts` | **AES-256-GCM** encrypt/decrypt (ENCRYPTION_KEY, 32-byte base64; falls back to AUTH_SECRET-derived); sha256, randomToken | ENGINE-1 | [LIVE] |
| `audit.ts` | **Hash-chained audit log** (per-org advisory lock, `prev_hash` chain); `rateLimit()` from audit_log (no Redis) | ENGINE-1 | [LIVE] |
| `pipeline.ts` | `prepare()`: layers 1–4 + canary-tagged messages for the LLM | ENGINE-1 | [LIVE] |
| `retrieval.ts` | **Fail-closed hybrid retrieval**: ACL predicate *inside SQL before ranking*; pgvector cosine + FTS RRF fusion; relevance floor + per-doc diversity | ENGINE-1 | [LIVE] |
| `providers.ts` | 10 BYOK providers + `custom` (https-only, see SSRF guard) | ENGINE-2 | [LIVE] |
| `llm.ts` | `callLLM()` (OpenAI-compatible + Anthropic Messages); **`assertSafeUrl` SSRF guard** on custom base URLs | ENGINE-2 | [LIVE] |
| `security/guard.ts` | Layer 2: 9-rule injection scanner (override, extraction, role-hijack, template injection, privilege claim, cross-tenant probe, exfil, obfuscation, blobs) + invisible-Unicode normalization; query block ≥0.7, chunk quarantine ≥0.8 | ENGINE-1 | [LIVE] |
| `security/redact.ts` | Layer 4: PII patterns (email, Aadhaar/ID, PAN, SSN, card/account, phone) → labels | ENGINE-1 | [LIVE] |
| `security/verify.ts` | Layer 5: **canary leak check**, markdown-image/link exfil strip, citation validity, token-overlap grounding score | ENGINE-1 | [LIVE] |
| `platform.ts` | Server platform profile: `VERCEL` env → vercel/self-hosted; DB reachability | ENGINE-2 | [MISSING] |
| `middleware.ts` | Redirect unauthenticated `/app/*` → `/login` | ENGINE-1 | [LIVE] |

### Client lib (`src/lib/client/`) — browser

| Module | Responsibility | Owner | Status |
|---|---|---|---|
| `api.ts` | `fetch` wrapper, same-origin credentials, error surfacing | UI | [LIVE] |
| `extract.ts` | File → text/rows: unpdf (PDF), mammoth (DOCX), xlsx (sheets/CSV/JSON), DOMParser (HTML), plain text fallback; images rejected (no OCR) | ENGINE-1 | [LIVE] |
| `chunk.ts` | Structure-aware chunker: ~900 chars, 150 overlap, heading carry-forward | ENGINE-1 | [LIVE] |
| `embed.ts` | **Transformers.js v3** `Xenova/bge-small-en-v1.5` → **384-d** normalized vectors; WebGPU → WASM fallback; query prefix for asymmetric search | ENGINE-1 | [LIVE] |
| `ingest.ts` | Chunk/embed batches (32/batch) → `POST /api/documents`; progress callbacks | ENGINE-1 | [LIVE] |
| `engines.ts` | Engine registry (localStorage) + runners: `loadWebLLM` (`CreateMLCEngine`), `ollamaTags`/`ollamaPull` (streaming), `lmstudioModels`, `runLocal` | ENGINE-2 | [LIVE] |
| `drive.ts` | Google Drive read-only via GIS token flow; export Google Docs/Sheets/Slides → downloadable `File` | ENGINE-1 | [LIVE] |
| `detect.ts` | Browser capability probes (Ollama/LM Studio reachability, WebGPU, secure context) feeding the platform badge | ENGINE-2 | [MISSING] |

### Components & pages → UI

| File | Responsibility | Status |
|---|---|---|
| `components/ui.tsx` | Button/Card/Input/Textarea/Select/Badge/Progress/SectionTitle/Label primitives (dark-first) | [LIVE] |
| `components/Chat.tsx` | Chat UX: engine badge, both query paths, grounding bar, evidence drawer, **security-trace (layers) drawer** | [LIVE] |
| `components/Knowledge.tsx` | Upload queue with progress, `AccessPicker` (visibility/roles), row-level subject column, doc list + delete | [LIVE] |
| `components/Connectors.tsx` | Postgres read-only SQL import + Google Drive picker → browser ingest | [LIVE] |
| `components/Team.tsx` | Org switch/create, invite creation, join-by-code, member role management | [LIVE] |
| `components/Models.tsx` | Engine picker (cloud keys / WebLLM / Ollama / LM Studio), BYOK key vault UI | [LIVE] |
| `components/Audit.tsx` | Audit log viewer | [LIVE] |
| `app/page.tsx` | Landing: 5-layer explainer | [LIVE] |
| `app/login/page.tsx` | Sign in / sign up | [LIVE] |
| `app/app/page.tsx` | Dashboard shell: sidebar tabs, org switcher, role/subject badges | [LIVE] |

## 3. Data flows

### (a) Ingest — why the browser does the heavy lifting

Vercel functions cap request bodies at **4.5 MB**, and raw files (PDF/DOCX/XLSX) would blow past that. So:

1. Browser: `extractFile()` → text (or rows for spreadsheets/JSON) — raw file bytes never leave the device.
2. Browser: `chunkText()` (~900 chars, 150 overlap) → `embed()` in batches of 16 via Transformers.js (384-d, rounded to 1e-6).
3. Browser: `ingest()` POSTs to `/api/documents` in batches of **≤32 chunks** — each request stays far under 4.5 MB. First batch creates the document (`documentId` returned), later batches append.
4. Server: zod validates (`chunks` 1–64, `content` ≤6000 chars, `embedding` exactly 384 finite numbers); viewers blocked; personal orgs forced to `private`.
5. Server: **every chunk is `scan()`ned** — score ≥ 0.8 → stored with `quarantined=true` (never retrieved), counted, audited (`ingest.quarantine`).
6. Embedding stored as `vector(384)`; `tsv` generated column feeds the GIN index for hybrid search.

Google Drive and Postgres-connector imports converge on the same path: Drive downloads → `extract.ts`; Postgres connector returns row-texts from the server → the **browser embeds them** (privacy + the same 4.5 MB constraint).

### (b) Query — cloud BYOK (`POST /api/chat`, all 5 layers)

1. Browser embeds the query (with the asymmetric query prefix) → `{query, embedding, keyId, model?}`.
2. `rateLimit(ctx)` (20/min from `audit_log`, no Redis).
3. `prepare()`: **L1** identity recorded → **L2** `scan(query)`, block ≥0.7 → **L3** `retrieve()` → **L4** poisoned chunks dropped, PII redacted for non-privileged readers, canary `PRM-…` minted and embedded in the system prompt as a confidential token.
4. Key fetched by id **scoped to the user** (`user_id = … or (shared and org_id = …)`), decrypted server-side, used once in `callLLM()`. The plaintext key is never sent to the browser (the keys GET route selects everything *except* `enc`).
5. `verifyAnswer()`: canary present → response withheld; else strip image/link exfil, drop invalid `[S#]`, compute grounding %, redact output PII for non-admins.
6. `audit(ctx, 'chat', {query slice, source doc ids, faithfulness, engine:'cloud'})` → response includes `layers[]` (the security trace the UI renders).

Zero-source shortcut: if no authorized chunks, the LLM is **not called** (zero cost, zero leakage) and the exact `REFUSAL` string is returned.

### (c) Query — local models (`POST /api/retrieve` → browser LLM → `POST /api/verify`)

1. Same as (b) steps 1–3, but the route stops after layers 1–4 and returns `{messages, layers, sources, auditId}`.
2. Server persists `{audit_uid, user_id, org_id, sources, canary, redact_output}` in `pending_answers` (rows >1h old are swept). The canary never goes anywhere except inside the signed system prompt and this row.
3. Browser runs the model **entirely locally**: WebLLM in-page, or `fetch` to `localhost:11434` / `localhost:1234` (the Vercel server could never reach these — this split is the whole reason local engines work on a Vercel deployment).
4. Browser POSTs `{auditId, answer}` to `/api/verify`; the server does a **single-use** `DELETE … RETURNING` (replay = 404), runs the same `verifyAnswer()`, audits `verify`, and returns the layer-5 trace which the UI appends to layers 1–4.

### (d) Signup → org → invite → role

1. `POST /api/auth/signup`: one transaction inserts `users` → `orgs(kind='personal')` → `memberships(role='owner')` → sets `active_org_id`; jose HS256 cookie set; audit `signup`.
2. `POST /api/orgs`: any signed-in user creates a `team` org and becomes its `owner` (also flips `active_org_id`).
3. `POST /api/invites` (admin+; owner-only when inviting admins; team orgs only): inserts `invites(code='PRM-'+hex, role, subject_ref, max_uses, expires_at=+7d)`; audit `invite.create`.
4. `POST /api/orgs/join`: `SELECT … FOR UPDATE` on the code; rejects unknown/over-used/expired; upserts membership with the invite's role + `subject_ref` (the row-level security key, e.g. a student ID); bumps `uses`; flips `active_org_id`; audit `org.join`.
5. `PATCH /api/members` (admin+): change role/`subject_ref`; owner role immutable; only owners can touch admins. `DELETE /api/members`: remove; owner cannot be removed.

Role rank order: `viewer(0) < member(1) < manager(2) < admin(3) < owner(4)`; `requireRole`/`atLeast` enforce it per route.

## 4. Security contracts (all [LIVE], verified in code)

| Contract | Mechanism | Verified |
|---|---|---|
| **Fail-closed retrieval** | `retrieval.ts → acl(ctx)`: `c.org_id = ctx.orgId AND c.quarantined = false AND (owner ∨ admin-on-non-private ∨ subject_ref match ∨ org-wide ∨ role-allowed)` — predicate is *inside* the SQL `WHERE` before vector/FTS ranking. All four values come from the server-derived `Ctx` (session cookie), never the request body | [LIVE] |
| **Injection firewall + quarantine** | `guard.ts`: 9 weighted rules + invisible-Unicode strip; query blocked at score ≥ 0.7 (`QUERY_BLOCK`); chunks quarantined at ≥ 0.8 (`CHUNK_QUARANTINE`) at ingest *and* re-scanned at query time (L4 drops) | [LIVE] |
| **PII shield** | `redact.ts`: email, Aadhaar/ID, PAN, SSN, card/account, phone → `[LABEL]`; applied to context for non-privileged readers *and* to model output (`redactOutput = !isAdmin(ctx)`) | [LIVE] |
| **Canary trap** | `pipeline.ts` mints `PRM-<random>` per request, embeds it as a "confidential security token" in the system prompt; `verify.ts` withholds the whole response if the canary appears in model output | [LIVE] |
| **Key vault** | `crypto.ts` AES-256-GCM with random 12-byte IV (`iv.tag.ct` base64 triple); keys stored in `api_keys.enc`, decrypted only in `/api/chat` server-side; key-list route never selects `enc` | [LIVE] |
| **CSRF** | `http.ts` `handler()`: on non-GET, rejects when `Origin` host ≠ request host (`x-forwarded-host` aware); session is a `SameSite=Lax`, httpOnly cookie | [LIVE] |
| **SSRF** | `llm.ts` `assertSafeUrl()`: custom provider base URLs must be `https:` and must not resolve to loopback / RFC-1918 / link-local / `.internal` ("use a local engine instead") | [LIVE] |
| **Hash-chained audit** | `audit.ts`: per-org `pg_advisory_xact_lock`, `hash = sha256(prev + uid + action + detail + created)`; tampering breaks the chain | [LIVE] |
| **Transport/clickjacking headers** | `next.config.mjs`: `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive permissions-policy, HSTS | [LIVE] |

## 5. API surface (from the real routes)

All routes set `export const runtime = 'nodejs'`. Every one below is **[LIVE]** (file exists, methods match). Anything from the mission/spec not present is marked **[MISSING]**.

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/auth/signup` | Register → personal org + session | [LIVE] |
| POST | `/api/auth/login` | Sign in → session | [LIVE] |
| POST | `/api/auth/logout` | Clear session | [LIVE] |
| GET | `/api/me` | Session ctx + orgs + Google client ID | [LIVE] |
| POST / PUT | `/api/orgs` | Create team org / switch active org | [LIVE] |
| POST | `/api/orgs/join` | Redeem invite code | [LIVE] |
| POST | `/api/invites` | Create invite (admin+) | [LIVE] |
| GET / PATCH / DELETE | `/api/members` | List / change role / remove member | [LIVE] |
| GET / POST / DELETE | `/api/documents` | List / batch-ingest chunks / delete doc | [LIVE] |
| GET / POST / DELETE | `/api/keys` | List (metadata only) / store encrypted key / delete | [LIVE] |
| POST | `/api/chat` | Cloud BYOK, full 5-layer pipeline | [LIVE] |
| POST | `/api/retrieve` | Local engines, layers 1–4 | [LIVE] |
| POST | `/api/verify` | Local engines, layer 5 | [LIVE] |
| POST | `/api/connectors/postgres` | Read-only SQL import (manager+) | [LIVE] |
| GET | `/api/audit` | Audit log (admin: org-wide; else own) | [LIVE] |
| GET | `/api/platform` | Platform profile + per-feature `{status, reason}` | [MISSING] — ENGINE-2 mission, in flight |

Spec-vs-code notes: the original spec's `db.ts` used the `postgres` package with a mandatory `DATABASE_URL`; the PGlite commit changed that (see §6). Everything else in `src` matches the spec's route/lib/component inventory 1:1, except the auto-detect trio which the spec never contained (it came from the user's headline ask in BLACKBOARD_V2).

## 6. The PGlite story — what `db.ts` actually does today

The spec showed `db.ts` as a thin `postgres`-package client requiring `DATABASE_URL`. **The PGlite commit replaced it** with a dual-mode module — this is the reality:

```ts
export const sql = g.__pramaanSql ??
  (isExternalDatabase(process.env.DATABASE_URL)
    ? postgres(DATABASE_URL, { max: 5, prepare: false, idle_timeout: 20 })  // Neon/Supabase/docker
    : createPgliteAdapter());                                              // embedded, default
```

- **Mode selection** is a URL heuristic: if `DATABASE_URL` avoids `localhost:5432` / `127.0.0.1:5432` / `postgres://postgres:postgres@localhost` / `postgres://localhost`, it's treated as external; **otherwise PGlite is used — including when `DATABASE_URL` is unset.** Zero-setup: `npm run dev` just works.
- **PGlite adapter**: `new PGlite(<cwd>/.pgdata, { extensions: { vector } })` (`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`), with a hand-written tagged-template layer that renumbers `$1…$n` params, supports nested fragments (`acl(ctx)` interpolation), `sql.json()`, `sql.begin()` (→ PGlite transactions), and `sql.unsafe()` — so all existing `postgres`-style call sites work unchanged.
- **Schema auto-init**: on first connection it `exec()`s `db/schema.sql` (with the `pgcrypto` extension line stripped — PGlite quirk) if present. `scripts/migrate.mjs` mirrors the same dual-mode logic for explicit migrations (`./.pgdata` vs external).
- `next.config.mjs` lists both PGlite packages under `experimental.serverComponentsExternalPackages` so they stay out of the client bundle.
- `pg-gateway` is in `package.json` but **imported nowhere in `src/`** — installed, unwired (see Debates).

**Schema** (`db/schema.sql`, [LIVE]): `users`, `orgs`, `memberships` (role + `subject_ref`), `invites`, `documents` (visibility + `allowed_roles`), `chunks` (`embedding vector(384)`, `tsv` generated column, HNSW cosine + GIN indexes, `quarantined`), `api_keys` (`enc`), `audit_log` (hash chain), `pending_answers` (retrieve→verify handoff). 9 tables.

⚠️ **Vercel caveat (filed as Debate #1):** the PGlite data dir is `<cwd>/.pgdata`. On Vercel serverless the filesystem is read-only except `/tmp` and nothing persists between invocations — so "embedded, works on Vercel" is true for *compute* but **data is ephemeral per-invocation** unless `DATABASE_URL` points at an external Postgres. The durable-production story on Vercel is external Postgres; PGlite is the zero-setup story for local dev/preview.

## 7. Auto-detect design

Required pieces (BLACKBOARD_V2 mission — the user's headline ask):

| Piece | Contract | Status |
|---|---|---|
| `src/lib/platform.ts` (server) | `getPlatform()`: `{ env: 'vercel' \| 'self-hosted' }` from `process.env.VERCEL`; DB mode from the same heuristic as `db.ts`; DB reachable probe | [MISSING] |
| `src/lib/client/detect.ts` (browser) | Probes: `fetch('http://localhost:11434/api/tags')` → Ollama (+ model list); `fetch('http://localhost:1234/v1/models')` → LM Studio; `!!navigator.gpu` → WebGPU; `window.isSecureContext`; each returns `{ available: boolean, reason: string }` | [MISSING] |
| `GET /api/platform` | Merges server profile + client probe results (client POSTs its probe, or server returns profile and browser merges) into per-feature list: `{ feature, status: 'available' \| 'unavailable' \| 'needs-setup', reason }` | [MISSING] |
| UI: platform badge + availability UX | Header badge (`Vercel`/`Local`); Models tab shows per-feature status **with the reason** — never a silent disable | [MISSING] (UI squad) |

**Reusable [LIVE] building blocks ENGINE-2 should wire in:** `engines.ts` already has `ollamaTags()` (hits `/api/tags`), `lmstudioModels()` (hits `/v1/models`), `loadWebLLM()` (throws a clear error when `navigator.gpu` is absent), and `embed.ts`'s WebGPU→WASM fallback — `detect.ts` is largely a thin, reason-string-producing wrapper around these. `db.ts`'s `isExternalDatabase` heuristic is the server-side DB-mode source of truth `platform.ts` should import rather than duplicate.

**Feature/limit matrix** (the "WHY NOT" table the UI must render):

| Feature | Vercel | Self-hosted / local | Needs | Why-not message |
|---|---|---|---|---|
| WebLLM (in-browser LLM) | ✅ | ✅ | WebGPU + model download (0.9–5 GB) | "WebGPU not available — use Chrome/Edge 113+ on desktop" |
| Browser embeddings | ✅ | ✅ | WebGPU or WASM (auto-fallback) | — (works everywhere) |
| Ollama | ❌ server-side, ✅ via browser | ✅ via browser | Ollama running on your machine | "Vercel can never reach your localhost — start Ollama on your machine; your browser talks to it directly" |
| LM Studio | ❌ server-side, ✅ via browser | ✅ via browser | LM Studio server + CORS enabled | "Enable 'Serve on local network' + CORS in LM Studio" |
| Cloud BYOK | ✅ | ✅ | An API key in Models & keys | "Add a key to ask via cloud models" |
| PGlite (embedded DB) | ✅ compute / ⚠️ ephemeral data | ✅ persistent on disk | — | "On Vercel, embedded data doesn't persist — set DATABASE_URL for durable storage" |

## 8. Vercel deployment notes

**Serverless-safe [LIVE]:** all routes are stateless (`runtime = 'nodejs'`); no Redis (rate limiting via `audit_log`); sessions in signed cookies (no server session store); PGlite embedded (no connection strings to manage); `pending_answers` TTL sweep is lazy (on `/api/retrieve` calls) — no cron needed.

**Env vars:**

| Var | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | No (PGlite default) | Set for durable production data (Neon/Supabase). Localhost values route to PGlite |
| `AUTH_SECRET` | **Yes** | ≥32 random chars; signs session JWTs |
| `ENCRYPTION_KEY` | **Yes** | 32 bytes base64; AES-256-GCM for BYOK keys. ⚠️ Changing it orphans stored keys |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | No | Only for the Google Drive connector |

**The 4.5 MB design consequence:** file reading, chunking, and embedding all happen in the browser; the server only ever receives small JSON batches (≤32 chunks, each ≤6000 chars + 384 floats). This is load-bearing, not incidental — moving embedding server-side would break Vercel uploads.

**`localhost` limitation (UI must say why):** Ollama (`:11434`) and LM Studio (`:1234`) run on the *user's* machine. Vercel's servers cannot dial back into a user's laptop. The architecture already accounts for this — local engines are driven browser→localhost, with the server only doing layers 1–4 (`/api/retrieve`) and 5 (`/api/verify`). The Models tab must explain this ("start Ollama on your machine") instead of showing a dead button.

**Watch-outs:** `maxDuration = 60` is set on `documents`/`chat`/`connectors/postgres` — Vercel Hobby caps at 10s (Pro 60s); large ingest batches may need smaller chunks on Hobby. PGlite cold-start applies `db/schema.sql` on first query (one-time cost per instance). `pg-gateway` is an unused dependency — remove or wire up (Debate #3).

---

*Filed debates live in `docs/BLACKBOARD_V2.md` → Debates (Referee resolves).*
