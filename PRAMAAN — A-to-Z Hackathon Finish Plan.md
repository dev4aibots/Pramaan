# PRAMAAN — A-to-Z Hackathon Finish Plan

**Repository reviewed:** `dev4aibots/pramaan`, branch `main`, commit `85942ba` (`Resume: final blackboard + platform updates`).  
**Purpose:** the fastest safe path from the current repo to a repeatable, judge-ready local demo. This is a plan and audit—not a claim that fixes have already been implemented.

## What is actually true today

- `npm ci` completed and `npm run build` **passes** on Node `v22.13.0`. Next generated the app and API routes. It emitted two critical-dependency warnings from `unpdf`'s PDF.js bundle.
- `npm audit` reported **21 advisories: 8 moderate, 11 high, 2 critical**. The direct dependency `next@14.2.18` is reported critical and is behind multiple patched releases; direct `unpdf@0.12.2` is also reported high. Tailwind and other transitive dependencies are affected. Do not blindly run `npm audit fix --force` during the demo sprint: it proposes major upgrades and could break Next/Tailwind/UnPDF. Upgrade in a branch and require build + smoke tests.
- There are **no project test files or test scripts**. Build success is not proof that signup, ingestion, ACL filtering, model calls, or verification work end-to-end.
- Core routes/components exist: auth, teams/invites, browser-side ingest, access-filtered retrieval, local/cloud engines, PostgreSQL connector, output verification, audit, and feature discovery. These are not yet demonstrated as a single reliable user journey by the evidence available here.
- The README is stale in places: its project tree omits code that exists now; its env sample says keys are required but the code silently derives encryption material if `ENCRYPTION_KEY` is absent/invalid; the local PGlite quick-start and `.env.example` wording do not agree.
- `docs/ARCHITECTURE.md` and `docs/BLACKBOARD_V2.md` contain valuable history, but the architecture document includes old “missing/in-flight” statements. Treat the live code and build as current; archive or clearly label historical status notes.

## Critical first moves — before polishing

### P0. Make the demo boot reproducibly (30–45 minutes)

1. Create a fresh working branch, record the current commit, and keep a clean rollback point. Avoid late, broad refactors on `main`.
2. Confirm the demo machine has Node 20/22, network access for first-time model downloads, and enough free disk. The WebLLM options are ~0.9–5 GB; **do not depend on downloading a multi-GB model during judging**.
3. Pick one primary inference path: **Ollama or cloud BYOK** for speed/repeatability. Keep the other engines as fallback only. WebLLM is a stretch unless the model has already been downloaded and tested on the actual demo browser/GPU.
4. Create ignored `.env.local` with fresh random `AUTH_SECRET` and a valid 32-byte base64 `ENCRYPTION_KEY`; never commit it or paste values into screenshots/logs. For an isolated local demo, PGlite is the fastest path; no `DATABASE_URL` is needed.
5. Run the exact clean-start sequence below and retain the output in the team’s own run notes:
   ```bash
   npm ci
   npm run db:migrate
   npm run build
   npm run start
   ```
   Verify `http://localhost:3000`, signup/login, `/api/me`, and `/api/platform`. Then stop/restart and check the local PGlite data is still present.
6. Add an actual `test` script and automated API/security smoke tests before calling the build “demo-ready.” Keep `npm run build` green after every dependency/code change.

**Gate:** clean checkout → install → migrate → build → start → signup/login → upload → authorized answer → audit page, with no manual DB surgery and no unhandled console errors.

### P1. Resolve critical security issues (do not demo sensitive real data)

1. **Upgrade Next.js first.** Move off `14.2.18` to a currently supported patched release compatible with this app; choose the smallest safe upgrade path first, then run `npm audit`, `npm run build`, and the smoke suite. The lockfile warning names direct, critical Next.js advisories. Check current official upgrade/security guidance when selecting the exact target; do not assume the newest major is a drop-in.
2. **Triage every advisory from the lockfile.** At minimum investigate Next, `unpdf`/PDF.js, `tar`, Tailwind/PostCSS, and all high/critical transitive paths. Pin patched ranges where safe; use overrides only when compatibility is tested. Record accepted residual advisories rather than hiding them.
3. **Fail closed on secrets.** In `src/lib/crypto.ts`, do not fall back to a hash of `AUTH_SECRET` or a hard-coded string for encryption. Validate a 32-byte `ENCRYPTION_KEY` at startup/key-write time; make missing/invalid production configuration a clear startup error. Keep AUTH and encryption keys separate. Add tests proving stored provider keys cannot be decrypted with a different key and are never returned by GET `/api/keys`.
4. **Harden external URLs and connectors.** In `src/lib/llm.ts`, custom HTTPS URL checks are string-based and do not fully block alternate/private IPv6 encodings, DNS rebinding, or redirects. Resolve and reject all loopback/private/link-local/multicast/reserved addresses, re-check redirects (or disable them), constrain ports, and set a hard timeout/response-size limit. For `src/app/api/connectors/postgres/route.ts`, user-supplied connection strings create a server-side network access/SSRF boundary; make this local-demo-only or use approved destination allowlists, block internal/cloud metadata IP ranges, require TLS where appropriate, and avoid returning raw driver error text to the client. The read-only transaction and 5,000-row cap are good controls but are not sufficient alone.
5. **Harden auth and request boundaries.** Add rate limits to signup/login/invite redemption and expensive key/model/ingest operations. `src/lib/http.ts` blocks mismatched Origin only when both Origin and host exist; explicitly define behavior for absent Origin and validate trusted proxy/host configuration. Ensure secure, HttpOnly, SameSite cookie behavior and clear logout cookies consistently. Add tests for unauthenticated access and cross-tenant attempts on every protected route.
6. **Prevent sensitive-data leakage.** Review all audit payloads in `src/app/api/chat/route.ts`, `/api/retrieve`, document, and connector routes. Avoid persisting raw user queries, secrets, prompt text, DB connection strings, and unnecessary PII; the current chat audit stores the first 300 query characters. Use structured redaction and a minimal event schema. Set retention/cleanup for `pending_answers`, and scope every lookup/delete by both user and organization.
7. **Review client-side secrets.** `src/components/Connectors.tsx` stores connector settings in `localStorage`; confirm no passwords/tokens/connection strings persist there. Prefer in-memory inputs and explicit “forget” behavior. Treat XSS prevention, dependency health, and local-browser extensions as part of the threat model.

**Gate:** production configuration fails loudly when keys are missing; forbidden URL probes are rejected; auth/rate-limit/tenant-isolation tests pass; no raw secrets appear in API errors, audit records, or browser storage.

### P2. Fix the most visible correctness gaps

1. **Make audit integrity verifiable.** `src/app/api/audit/route.ts` returns `hash` but not `prev_hash`, while `Audit.tsx` displays a positive “Tamper-Evident SHA-256 Chain” banner. The chain cannot be independently validated from the current API response. Return the required chain fields or a server-computed verification result, and have the UI show **verified / broken / unavailable** based on an actual check. Never show “verified” just because entries loaded.
2. **Make document re-ingestion idempotent.** In `src/app/api/documents/route.ts`, updates add chunks and increment counts; they do not replace prior chunks. Retrying a failed upload may duplicate chunks and distort `chunk_count`. Define replace/append semantics; preferably replace a document’s chunk set atomically, with stable upload IDs and safe retry behavior. Test partial failures and repeated upload.
3. **Verify citations, not just citation-shaped text.** `src/lib/security/verify.ts` must be tested against missing citation IDs, fabricated `[S99]`, unsupported clauses, empty model output, PII patterns, canary leakage, and the no-evidence refusal. Present grounding as a heuristic unless tests establish stronger guarantees; don’t claim every factual assertion is proven by current code alone.
4. **Make ingest limits explicit.** UI and API limits differ in places (chunk count and payload expectations); exercise PDFs, DOCX, CSV/XLSX, plain text, corrupt files, oversized files, empty files, and prompt-injection samples. Validate total request bytes, extracted text length, chunk count, and processing time on both client and server. Show per-file failure and retry state without misleading “nothing stored” messages if partial state is possible.
5. **Test the model-connection path end-to-end.** Verify API key add/list/delete and one real chat for each selected provider/engine. The chat API expects a 384-dimensional embedding and a valid user-owned/shared `keyId`; verify the UI sends the chosen key/model and reports provider errors safely. Test retrieval→local generate→`/api/verify` as one sequence. Check provider model IDs against the current APIs; the checked-in Anthropic model names and provider catalogs may age quickly.
6. **Prove ACL rules with adversarial tests.** Create two users, two workspaces, private/org/role-limited docs, and subject-scoped chunks. Assert user B never receives user A’s private document title, source, chunk, citation, or count via list, chat, retrieval, audit, or error path. Test role changes and workspace switching immediately affect access.
7. **Check organization invariants.** Test last-owner protection, manager/admin boundaries, duplicate invite redemption, expired/max-use invites, rejoin semantics, and member removal. `members` and invite operations need race tests for concurrent redemption and role changes.

## P3. Turn the app into a comfortable, judge-friendly demo

The UI is already substantial: dark layout, responsive tabs, knowledge queue, evidence cards, stage/layer traces, platform status, and role controls. Improve discoverability and confidence rather than redesigning everything.

1. **First-run “Demo setup” checklist:** show database status, embedding readiness, active model, sample-data status, and a button/link to the next required step. Default new local accounts to a clearly labeled safe sample workspace or provide a one-click seed script.
2. **Seed deterministic demo identities/data locally.** Add an opt-in `npm run demo:seed` script that creates fictional records only: one manager/professor and one viewer/student, team membership, and documents containing distinct public/private/subject-scoped facts plus one clearly labeled poisoned fixture. Use disposable demo credentials generated or printed locally, never hard-coded production credentials. Include reset/cleanup.
3. **A single main demo route:** upload/seed → ask an allowed question → click citation → ask a fact the demo viewer cannot access → show refusal → submit a visibly malicious prompt/document → show block/quarantine → open audit and verify the specific events. Do not require changing accounts in the middle unless the role switch has been rehearsed; separate browser profiles/incognito windows are more reliable.
4. **Clearly label the active inference engine and data path.** Show “Ollama (local)” or “Cloud provider (BYOK)” and whether raw files are processed in-browser. Do not claim “air-gapped” unless network traffic and dependencies are actually disabled; first-load model/dependency downloads mean the app is not automatically air-gapped.
5. **Error comfort:** keep actionable messages next to the failed connector/model, preserve non-secret form inputs, add retry and copy-safe diagnostics, and explain whether the operation may have partially succeeded. Disable actions during in-flight work. Check mobile overflow and keyboard/focus navigation at the actual screen size.
6. **Accessibility/comfort pass:** keyboard-only navigation, visible focus, modal focus trapping/restoration, labels/errors associated with inputs, sufficient contrast, reduced motion, screen-reader announcements for upload/chat status, and usable 320–390px widths. Test the current demo machine’s browser instead of assuming support from feature detection alone.
7. **Remove duplicate/unused UI paths.** `FeatureStatus.tsx` appears to implement another availability system while `/app/page.tsx` has a `PlatformBadge`; determine which is actually mounted, remove stale code or unify the source of truth. Fix stale docs so judges and teammates see one accurate product story.

**Gate:** first-time user can reach a successful question in ≤3 minutes on the demo laptop; failures provide a recovery path; every visible control in the demo flow does something; UI does not claim a security event that cannot be verified.

## P4. The minimum test suite that makes “no mistakes” more realistic

Add fast, deterministic automated tests. Prioritize pure security functions and route behavior; avoid requiring GPU or paid API keys in CI.

- **Unit:** `guard.scan` (plain/hidden instructions/Unicode cases), `redact`, `verifyAnswer`, URL allow/deny rules, encryption key validation, `mergePlatform`, chunking and file-type validation.
- **API integration:** signup/login/logout; auth required; workspace isolation; roles; invite expiry/use count; encrypted key metadata only; upload/replace/delete; malicious query blocked; private evidence excluded; no-evidence refusal avoids LLM call; retrieval→verify owner binding; rate-limit response; audit-chain tamper detection.
- **Connector tests:** hostile SQL statements, multi-statement attempts, private/metadata destinations, timeout, large rows, and sanitized error output.
- **Browser E2E:** one Playwright happy path and one attack/refusal path on Chromium. Stub only the model boundary in CI; add a manual checklist for the real Ollama/BYOK call on demo day.
- **Regression:** repeat upload does not duplicate chunks; deleted document is absent from search; user switching workspace cannot use a stale key or pending answer; reloaded browser retains only intended preferences.
- **Build/lint/security gates:** `npm ci`, unit/API/E2E smoke tests, `npm run build`, and `npm audit --omit=dev` plus full `npm audit` triage. Avoid “fix all by force” right before the event.

## P5. Local runbook and failure recovery

1. Commit an accurate `README.md` update: Node version, local PGlite path, valid environment variables, exact setup commands, selected demo engine, supported formats, and known limitations.
2. Add `.env.example` values as placeholders with explicit “replace locally”; clarify whether keys are required for all modes or only cloud-key storage. Add a startup config validator.
3. Add scripts: `demo:seed`, `demo:reset`, and `smoke` (or equivalent). Keep demo data fictional and deterministic.
4. Rehearse three recovery modes: (a) Ollama fails → preconfigured BYOK key if available; (b) provider/network unavailable → prerecorded/local fixture response explicitly labeled as fallback, not live; (c) app/database restart → restart instructions and durable local `.pgdata` check.
5. Keep a clean demo profile and backup of the demo repository/database. Do not use real student/employee personal data. Disable screen notifications and browser autofill popups.
6. Have a 60-second architecture fallback with screenshots/short capture only if live service breaks; be honest that it is a recording, not a live run.

## P6. Judge-facing pitch and demonstration script (6 minutes + Q&A)

The current `PRESENTATION_SCRIPT.txt` says “~7 minutes (5 min pitch + 2 min demo)” but its timed sections add to about **6 minutes** before Q&A; the demo beats total 90 seconds. Use a timer and align the spoken claims with features proven in the running build.

### 0:00–0:25 — Hook
“An AI that can search every company document is useful. It is also a new way to expose the wrong record, follow a poisoned instruction, or invent an answer. PRAMAAN asks one question before it answers: what evidence is this user allowed to see?”

### 0:25–1:00 — Product in one line
“PRAMAAN is a security boundary around document Q&A. It scans incoming text, applies permissions before retrieval results reach the model, checks the outgoing answer, and records the decision. We’ll show those controls, not ask you to take the slide’s word for it.”

### 1:00–1:25 — Workflow map
Point to the actual running product: ingest → scan/quarantine → permission-filter retrieval → model → output check → audit. Say **“designed to reduce unsupported answers”**, not “eliminates hallucinations.” Say **“hash-linked audit events”** only after the API/UI can actually verify the chain.

### 1:25–3:25 — Live demo (keep under 2 minutes)
1. Ask a seeded, answerable question as the viewer. Click its citation and show the source excerpt.
2. Ask for a fictional record the viewer is not allowed to see. Show refusal and the retrieval/security trace. If a professor account is part of the script, switch to a separately pre-opened profile and ask the same question there.
3. Submit the prepared malicious prompt or upload the labeled poisoned document. Show the block/quarantine result and corresponding audit event.
4. End on the verified audit result, not a marketing dashboard.

### 3:25–4:20 — Why it matters / honest boundary
“The model does not decide access. PRAMAAN filters authorized evidence before synthesis. Prompt-injection detection and grounding are defense-in-depth—not a proof that every possible attack or hallucination is impossible. The demo uses fictional records and a preselected model so the security behavior is reproducible.”

### 4:20–5:10 — Architecture and local reliability
“One Next.js app, an embedded local Postgres-compatible store for the demo, browser-side document extraction/embeddings, and an explicitly selected local or BYOK inference engine. The local path avoids a database setup; first-time browser/model downloads still need preparation. Cloud deployment needs durable external PostgreSQL rather than ephemeral serverless disk.”

### 5:10–5:40 — Close
“PRAMAAN makes the evidence path visible: who asked, what they could retrieve, what the answer cited, and how the response was checked. Our next work is independent security verification, stronger audit validation, and broader automated tests.”

**Q&A answer discipline:** show code or a test for a security claim; otherwise call it a mitigation or limitation. Do not claim production-grade zero-trust, air-gap readiness, perfect PII removal, universal format support, or zero hallucinations without separate proof.

## Recommended execution order under a hackathon clock

1. **First:** configure local secrets, choose the tested engine, seed fictional users/data, and get the whole demo flow working manually.
2. **Second:** verify/fix audit integrity UI, repeat-upload behavior, and at least the viewer-vs-manager ACL cases.
3. **Third:** upgrade patched Next/dependencies in a separate branch and retest. If a dependency migration threatens demo stability, do not deploy the vulnerable old app publicly; keep the demo local and explain the upgrade branch/status honestly.
4. **Fourth:** add focused regression tests, improve error recovery, rehearse twice on the target machine.
5. **Last:** polish copy/layout and pitch timing. Freeze code after a full green run; no last-minute dependency or UI changes.

## Definition of “demo-ready”

- Clean install, migration, production build, and startup work from the README.
- A new/demo account can complete the golden path with no hidden setup.
- The same fictional record is accessible only to the permitted role; unauthorized data never appears in retrieved sources or citations.
- Malicious prompt/document path produces a visible, audited block/quarantine.
- Answer evidence and audit-chain status are truthful and inspectable.
- No secrets, raw connection strings, or unnecessary query content are exposed in browser storage, logs, or API errors.
- All critical/high dependency findings are patched or explicitly contained from public deployment; local demo limitations are disclosed.
- The full pitch runs inside the event’s actual time limit, with a tested fallback.
