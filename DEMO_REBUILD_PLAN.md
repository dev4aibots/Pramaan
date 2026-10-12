# PRAMAAN Zero-Config Demo — Rebuild Plan

## Brainstorm: Architecture Decisions

### What already exists (leverage, don't rebuild)
- `src/lib/demo.ts` — full demo mode: deterministic UUIDs, `isDemoMode()`, `ensureDemoSeeded()` with 4 seeded documents, hash embeddings (384-d trigram)
- `src/app/api/demo/route.ts` — GET (mode check) + POST (create demo session, no password)
- `src/components/TryDemoButton.tsx` — "Try the live demo" button, POSTs to /api/demo, redirects to /app
- Landing page renders TryDemoButton when `isDemoMode()` (nav + hero)
- `src/lib/http.ts` calls `ensureDemoSeeded()` before every API route — seed is idempotent
- All env vars have fallbacks: AUTH_SECRET, ENCRYPTION_KEY (→ SHA256 of auth secret), NVIDIA_API_KEY (→ browser mode), DATABASE_URL (→ PGlite)
- Parsers in package.json: `mammoth` (DOCX), `unpdf` (PDF), `xlsx` (spreadsheets)

### What is missing (build now)
1. **View Documents button** — no UI exists to list/verify loaded documents
2. **Demo banner** — no visual indicator of demo mode
3. **File type enforcement** — parsers exist but upload handler needs audit: does it accept TXT/PDF/DOCX/MD/CSV/HTML? Does it reject video/audio with clear errors?
4. **Mixed-format seeds** — all 4 seeds are `text/plain`; need at least PDF and DOCX seeds to prove multi-format pipeline works end-to-end

### Architecture decisions
- **Demo auth:** Reuse existing `POST /api/demo` → `createSession(DEMO_USER_ID)`. No changes needed. Deterministic UUIDs mean the JWT survives across serverless invocations.
- **Seeding:** Reuse `ensureDemoSeeded()`. Idempotent (checks for DEMO_USER_ID first). Called from http handler — no new wiring needed.
- **View Documents:** New React component in workspace (`/app` route). Fetches from existing `GET /api/documents`. Shows: title, mime type badge, size, chunk count, upload date. Expandable row → content preview (first N chars from `GET /api/documents/chunks?documentId=`).
- **Demo banner:** Small fixed-top banner in `/app` layout, rendered when `isDemoMode()`. Text: "Demo Mode — data resets periodically." Dismissible per session (localStorage).
- **File validation:** Audit `src/app/api/documents/route.ts` (upload handler). Add explicit MIME/extension allowlist: txt, pdf, doc, docx, md, csv, html, xls, xlsx. Blocklist: video/*, audio/*. Return 400 with clear message: "Video and audio files are not supported. Please upload a document (TXT, PDF, DOCX, MD, CSV, HTML)."
- **Mixed seeds:** Generate a real PDF and DOCX in the seed script (or store pre-built binary seeds). Simpler: extend SEED_DOCS with `mime: 'application/pdf'` entries whose chunks are extracted text — the pipeline is what matters, not the binary. But to truly prove it, include one real PDF parse test.

### Risk analysis
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PGlite ephemeral on Vercel — seed runs every cold start | High | Already handled: seed is idempotent, one SELECT check |
| Hash embeddings (not ML) give poor retrieval | Medium | Retrieval is hybrid (vector RRF + keyword tsv 1.2x boost); keyword queries work. Acceptable for demo. |
| PDF/DOCX parsing fails on Vercel (native deps) | Medium | `unpdf` and `mammoth` are pure JS/WASM — no native deps. Verify in build. |
| Demo session collides with real user | Low | Deterministic UUIDs in reserved `00000000-...` range; real UUIDs never collide in practice. |
| Upload size limits on Vercel (4.5MB) | Medium | Client-side parsing already implemented (browser reads files). Verify. |

### Worker assignments
1. **Worker A — View Documents UI:** Build `DocumentViewer` component. Button with 📄 icon (FileText from lucide-react) in workspace header. Panel/modal listing documents from `GET /api/documents`. Each row: title, type badge, size, chunks, date. Expandable preview. Tests: component renders, fetches correctly, handles empty/error states.
2. **Worker B — Demo banner + polish:** Banner component in `/app` layout. Show when `isDemoMode()`. Dismissible. Also verify TryDemoButton renders correctly on landing page in demo mode. Tests: banner shows/hides correctly.
3. **Worker C — File upload audit + enforcement:** Read `src/app/api/documents/route.ts`. Verify each parser (TXT, PDF via unpdf, DOCX via mammoth, MD, CSV, HTML, XLSX). Add allowlist/blocklist. Clear error for video/audio. Tests: upload each type, verify text extraction, verify rejection.
4. **Worker D — Seed enhancement:** Add 2 more seed documents (one marked as PDF-sourced, one as DOCX-sourced) with queryable facts. Verify seed runs idempotently. Tests: seed creates 6 docs, re-running doesn't duplicate.
5. **Worker E — Integration tests:** End-to-end: POST /api/demo → session created → GET /api/documents → 6 docs → upload a TXT → query returns cited answer. All API-level, no browser needed.

### Definition of done
- [ ] Try Demo button → one click → workspace with seeded docs, no signup
- [ ] View Documents button visible in workspace, lists all docs with preview
- [ ] Demo banner visible in workspace
- [ ] Upload TXT, PDF, DOCX, MD, CSV, HTML all work; video/audio rejected with clear message
- [ ] 6 seeded documents with queryable facts across formats
- [ ] All worker tests pass
- [ ] `npm run build` succeeds
- [ ] Push to main
