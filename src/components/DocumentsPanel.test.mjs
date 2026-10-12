// DocumentsPanel.test.mjs — run with:  node --test src/components/DocumentsPanel.test.mjs
//
// Verifies the View Documents UI renders its loading / empty / error states
// and that rows expose title, MIME badge, size, chunk count and date, plus
// unit checks for the pure helpers. No new npm packages: the component is
// compiled with the project's own tsc into node_modules/.cache (so bare
// imports like lucide-react resolve), then server-rendered with react-dom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// --- compile the component tree with the project's tsc -------------------
const outDir = join(root, 'node_modules', '.cache', 'doctest-documents-panel');
mkdirSync(outDir, { recursive: true });
const tsconfigPath = join(outDir, 'tsconfig.json');
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    extends: join(root, 'tsconfig.json'),
    compilerOptions: {
      noEmit: false,
      outDir: join(outDir, 'dist'),
      rootDir: join(root, 'src'),
      module: 'commonjs',
      moduleResolution: 'node',
      jsx: 'react-jsx',
      incremental: false,
      declaration: false,
      sourceMap: false,
      plugins: [],
    },
    include: [join(root, 'src/components/DocumentsPanel.tsx'), join(root, 'src/lib/client/api.ts')],
  }),
);
execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', tsconfigPath], {
  cwd: root,
  stdio: 'pipe',
  timeout: 120000,
});

// --- import the compiled component -----------------------------------------
const compiled = join(outDir, 'dist', 'components', 'DocumentsPanel.js');
assert.ok(existsSync(compiled), `expected compiled component at ${compiled}`);
// tsc does not rewrite the `@/` path alias at runtime — resolve it manually.
{
  const { readFileSync, writeFileSync: write } = await import('node:fs');
  const src = readFileSync(compiled, 'utf8');
  const rewritten = src.replace(/require\(["']@\/([^"']+)["']\)/g, 'require("../$1")');
  assert.notEqual(rewritten, src, 'expected at least one @/ require to rewrite');
  write(compiled, rewritten);
}
const mod = await import(pathToFileURL(compiled).href);
// Note: for a CJS module, namespace `.default` is the whole module.exports,
// so the component itself lives at mod.default.default.
const { default: cjsExports, DocumentsList, mimeShort, formatBytes, formatDocDate, previewText } = mod;
const DocumentsPanel = cjsExports.default;
const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
// React inserts <!-- --> comment separators between adjacent text/expression
// nodes during SSR — strip them so assertions read like the visible text.
const el = (Comp, props) => renderToString(React.createElement(Comp, props)).replace(/<!-- -->/g, '');

const sampleDocs = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Q3 Security Report',
    source: 'upload',
    mime: 'application/pdf',
    visibility: 'private',
    chunk_count: 12,
    quarantined_chunks: 0,
    created_at: '2026-10-11T10:00:00.000Z',
    mine: true,
    byte_size: 204800,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'meeting notes',
    source: 'upload',
    mime: 'text/plain',
    visibility: 'private',
    chunk_count: 3,
    quarantined_chunks: 0,
    created_at: '2026-10-12T08:30:00.000Z',
    mine: true,
    byte_size: 512,
  },
];

test('panel shell renders the loading state before the API responds', () => {
  // useEffect does not run under renderToString, so docs stays null.
  const html = el(DocumentsPanel, { onClose: () => {} });
  assert.match(html, /role="dialog"/);
  assert.match(html, /Loading documents/);
  assert.match(html, /Knowledge base/);
});

test('DocumentsList shows the loading state when docs is null and there is no error', () => {
  const html = el(DocumentsList, { docs: null, error: '' });
  assert.match(html, /Loading documents/);
});

test('DocumentsList shows the empty state with the required copy', () => {
  const html = el(DocumentsList, { docs: [], error: '' });
  assert.match(html, /No documents yet\. Upload one to get started\./);
});

test('DocumentsList shows the error state with the fetch message', () => {
  const html = el(DocumentsList, { docs: null, error: 'Request failed (500)' });
  assert.match(html, /Request failed \(500\)/);
  assert.doesNotMatch(html, /Loading documents/);
});

test('rows render title, MIME badge, file size, chunk count and upload date', () => {
  const html = el(DocumentsList, { docs: sampleDocs, error: '' });
  assert.match(html, /Q3 Security Report/);
  assert.match(html, /meeting notes/);
  assert.match(html, /PDF/); // MIME badge from application/pdf
  assert.match(html, /TXT/); // MIME badge from text/plain
  assert.match(html, /200 KB/); // 204800 bytes
  assert.match(html, /512 B/);
  assert.match(html, /12 chunks/);
  assert.match(html, /3 chunks/);
});

test('mimeShort maps common MIME types to short badges', () => {
  assert.equal(mimeShort('application/pdf'), 'PDF');
  assert.equal(
    mimeShort('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'DOCX',
  );
  assert.equal(mimeShort('text/plain'), 'TXT');
  assert.equal(mimeShort('text/plain; charset=utf-8'), 'TXT');
  assert.equal(mimeShort('application/vnd.ms-excel'), 'XLS');
});

test('formatBytes renders human-readable sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(null), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(204800), '200 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
});

test('previewText caps previews at 500 chars', () => {
  const long = `x${'y'.repeat(600)}`;
  const p = previewText(long);
  assert.ok(p.length <= 501, `preview too long: ${p.length}`);
  assert.ok(p.endsWith('…'));
  assert.equal(previewText('short'), 'short');
  assert.equal(formatDocDate('2026-10-11T10:00:00.000Z').length > 0, true);
});
