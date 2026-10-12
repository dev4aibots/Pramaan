/**
 * Upload file-type policy tests for PRAMAAN demo (Worker C).
 *
 * Covers:
 *   (a) valid file  -> text extracted correctly (txt, md, csv, xlsx, docx, pdf via real parsers)
 *   (b) video/audio -> rejected with the exact required error message
 *   (c) unsupported -> rejected with an error listing the supported types
 *   (d) server guard (uploadGuardError, the exact function POST /api/documents calls)
 *
 * Run:  node tests/upload-policy.test.mjs   (or: npm test)
 * No test runner dependency — plain Node + the project's own tsc.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Build inside the project so the compiled ESM resolves unpdf/mammoth/xlsx
// from the project's node_modules (ESM ignores NODE_PATH). Cleaned up at the end.
const BUILD = join(ROOT, 'tests', '.build');
const NM = join(ROOT, 'node_modules');
rmSync(BUILD, { recursive: true, force: true });

// ---- 1. compile the real sources (policy.ts + extract.ts) to ESM ----
{
  mkdirSync(join(BUILD, 'src'), { recursive: true });
  const extractSrc = readFileSync(join(ROOT, 'src/lib/client/extract.ts'), 'utf8')
    .replace(`from '@/lib/files/policy'`, `from './policy.js'`);
  writeFileSync(join(BUILD, 'src/policy.ts'), readFileSync(join(ROOT, 'src/lib/files/policy.ts'), 'utf8'));
  writeFileSync(join(BUILD, 'src/extract.ts'), extractSrc);
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'),
    ['src/policy.ts', 'src/extract.ts', '--outDir', 'dist', '--module', 'nodenext',
     '--moduleResolution', 'nodenext', '--target', 'es2022', '--skipLibCheck'],
    { cwd: BUILD, stdio: 'pipe' });
  // compiled output must resolve unpdf/mammoth/xlsx -> link project's node_modules
  mkdirSync(join(BUILD, 'dist'), { recursive: true });
  // Node build of mammoth lacks the browser unzip shim (arrayBuffer support);
  // redirect 'mammoth' to a wrapper that translates arrayBuffer -> buffer so the
  // REAL extractFile docx branch is exercised in Node.
  writeFileSync(join(BUILD, 'dist/mammoth-shim.mjs'),
    `import * as real from ${JSON.stringify(join(NM, 'mammoth/lib/index.js'))};\n` +
    `const m = real.default ?? real;\n` +
    `export async function extractRawText(input) {\n` +
    `  if (input && input.arrayBuffer && !input.buffer && !input.path)\n` +
    `    return m.extractRawText({ buffer: Buffer.from(input.arrayBuffer) });\n` +
    `  return m.extractRawText(input);\n}\n`);
  writeFileSync(join(BUILD, 'redirect.mjs'),
    `export async function resolve(specifier, context, next) {\n` +
    `  if (specifier === 'mammoth')\n` +
    `    return { url: new URL('./dist/mammoth-shim.mjs', import.meta.url).href, shortCircuit: true };\n` +
    `  return next(specifier, context);\n}\n`);
}
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL(join(BUILD, 'redirect.mjs')).href);

const policy = await import(join(BUILD, 'dist/policy.js'));
const { extractFile } = await import(join(BUILD, 'dist/extract.js'));
const { classifyUpload, uploadGuardError, containsBinary, MEDIA_ERROR } = policy;

// ---- 2. tiny test harness ----
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
async function throwsMsg(name, fn, expected) {
  try { await fn(); ok(name, false, 'did not throw'); }
  catch (e) { ok(name, e.message === expected, `got: ${JSON.stringify(e.message)}`); }
}

// ---- 3. policy classification ----
console.log('policy.classifyUpload');
for (const [f, mime] of [
  ['notes.txt', 'text/plain'], ['N.TXT', 'text/plain'], ['r.pdf', 'application/pdf'],
  ['d.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['p.md', 'text/markdown'], ['c.csv', 'text/csv'], ['i.html', 'text/html'], ['i.htm', 'text/html'],
  ['s.xls', 'application/vnd.ms-excel'],
  ['s.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['paste', 'text/plain'],
]) ok(`allow ${f}`, classifyUpload(f, mime).ok === true);

for (const [f, mime] of [
  ['m.mp4', 'video/mp4'], ['m.MP4', ''], ['c.avi', ''], ['c.mov', 'video/quicktime'],
  ['v.webm', 'video/webm'], ['s.mp3', 'audio/mpeg'], ['s.MP3', ''], ['r.wav', 'audio/wav'],
  ['a.ogg', ''], ['x.m4a', 'audio/mp4'], ['x.wma', ''], ['blob', 'video/mp4'],
]) {
  const v = classifyUpload(f, mime);
  ok(`media ${f}/${mime || '(no mime)'}`, v.ok === false && v.kind === 'media' && v.error === MEDIA_ERROR,
    JSON.stringify(v));
}

{
  const v = classifyUpload('old.doc', 'application/msword');
  ok('legacy .doc rejected with docx guidance', v.ok === false && v.kind === 'legacy-doc' && /re-save.*\.docx/i.test(v.error));
}
for (const [f, mime] of [
  ['app.exe', 'application/octet-stream'], ['a.zip', 'application/zip'], ['pic.png', 'image/png'],
  ['photo.jpg', 'image/jpeg'], ['data.json', 'application/json'], ['d.tsv', 'text/tab-separated-values'],
  ['s.ods', 'application/vnd.oasis.opendocument.spreadsheet'], ['x', 'application/octet-stream'],
  ['evil.mp4.txt.exe', ''], ['noext', ''],
]) {
  const v = classifyUpload(f, mime);
  ok(`reject ${f}`, v.ok === false && v.kind !== 'media' && /TXT.*PDF.*DOCX/i.test(v.error || ''), JSON.stringify(v));
}
ok('containsBinary detects NUL', containsBinary('ab\u0000cd') === true);
ok('containsBinary passes clean text', containsBinary('hello\nworld') === false);

// ---- 4. server guard (exact function used by POST /api/documents) ----
console.log('server.uploadGuardError');
ok('server allows txt', uploadGuardError('notes.txt', 'text/plain', ['hello']) === null);
ok('server rejects mp4 with exact media error',
  uploadGuardError('m.mp4', 'video/mp4', ['x']) === MEDIA_ERROR);
ok('server rejects mp4 by extension alone',
  uploadGuardError('m.mp4', '', ['x']) === MEDIA_ERROR);
ok('server rejects audio with exact media error',
  uploadGuardError('s.mp3', 'audio/mpeg', ['x']) === MEDIA_ERROR);
{
  const e = uploadGuardError('a.exe', 'application/octet-stream', ['x']);
  ok('server rejects exe listing supported types', typeof e === 'string' && /TXT.*PDF.*DOCX/i.test(e), e);
}
ok('server rejects legacy .doc', /re-save.*\.docx/i.test(uploadGuardError('o.doc', '', ['x']) || ''));
ok('server rejects binary chunk smuggling',
  /binary/i.test(uploadGuardError('notes.txt', 'text/plain', ['ok', 'a\u0000b']) || ''));
ok('server rejects media even with clean chunks', uploadGuardError('v.avi', '', ['clean text']) === MEDIA_ERROR);

// ---- 5. extraction with REAL files ----
console.log('extractFile (real parsers)');
const F = (content, name, type) => new File([content], name, { type });

// (a) txt / md
{
  const r = await extractFile(F('Hello PRAMAAN demo text.', 'n.txt', 'text/plain'));
  ok('txt extracts', r.text === 'Hello PRAMAAN demo text.', JSON.stringify(r.text));
  const m = await extractFile(F('# Title\n\nSome **md** body.', 'p.md', 'text/markdown'));
  ok('md extracts', (m.text || '').includes('Title') && (m.text || '').includes('Some **md** body.'));
}
// (a) csv via xlsx parser
{
  const r = await extractFile(F('name,age\nann,30\nbob,25\n', 'd.csv', 'text/csv'));
  ok('csv rows extract', !!r.rows && r.rows.length === 2 && r.rows[0].text.includes('ann') && r.rows[0].text.includes('30'),
    JSON.stringify(r.rows));
}
// (a) xlsx built with the real xlsx package
{
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['city', 'temp'], ['Rajkot', 34], ['Delhi', 29]]), 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const r = await extractFile(F(buf, 's.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  ok('xlsx rows extract', !!r.rows && r.rows.length === 2 && r.rows[0].text.includes('Rajkot') && r.rows[0].text.includes('34'),
    JSON.stringify(r.rows));
}
// (a) docx: hand-built minimal stored-zip, parsed by the real mammoth
{
  const docx = buildDocx('Hello DOCX world from PRAMAAN');
  const r = await extractFile(F(docx, 'd.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  ok('docx extracts via mammoth', (r.text || '').includes('Hello DOCX world from PRAMAAN'), JSON.stringify(r.text));
}
// (a) pdf: hand-built minimal PDF, parsed by the real unpdf
{
  const pdf = buildPdf('Hello PDF world from PRAMAAN');
  const r = await extractFile(F(pdf, 'r.pdf', 'application/pdf'));
  ok('pdf extracts via unpdf', (r.text || '').includes('Hello PDF world from PRAMAAN'), JSON.stringify((r.text || '').slice(0, 120)));
}
// (b) video/audio rejected with the EXACT required message
await throwsMsg('extract rejects mp4 (mime)', () => extractFile(F(new Uint8Array(16), 'm.mp4', 'video/mp4')), MEDIA_ERROR);
await throwsMsg('extract rejects avi (ext only)', () => extractFile(F(new Uint8Array(16), 'c.avi', '')), MEDIA_ERROR);
await throwsMsg('extract rejects mp3 (mime)', () => extractFile(F(new Uint8Array(16), 's.mp3', 'audio/mpeg')), MEDIA_ERROR);
await throwsMsg('extract rejects wav (ext only)', () => extractFile(F(new Uint8Array(16), 'r.wav', '')), MEDIA_ERROR);
await throwsMsg('extract rejects webm', () => extractFile(F(new Uint8Array(16), 'v.webm', 'video/webm')), MEDIA_ERROR);
// (c) unsupported rejected, error lists supported types
for (const [f, mime] of [['a.exe', 'application/octet-stream'], ['p.png', 'image/png'], ['d.json', 'application/json'], ['s.ods', '']]) {
  try { await extractFile(F('x', f, mime)); ok(`extract rejects ${f}`, false, 'did not throw'); }
  catch (e) { ok(`extract rejects ${f}`, /TXT.*PDF.*DOCX/i.test(e.message), e.message); }
}
try { await extractFile(F('x', 'o.doc', 'application/msword')); ok('extract rejects .doc', false, 'did not throw'); }
catch (e) { ok('extract rejects .doc with docx guidance', /re-save.*\.docx/i.test(e.message), e.message); }

// ---- 6. route wiring: POST handler must call the guard ----
console.log('route wiring');
{
  const src = readFileSync(join(ROOT, 'src/app/api/documents/route.ts'), 'utf8');
  ok('route imports uploadGuardError', src.includes("from '@/lib/files/policy'"));
  ok('route calls uploadGuardError on title/mime/chunks',
    src.includes('uploadGuardError(b.title, b.mime, b.chunks.map((c) => c.content))'));
  ok('route throws HttpError 400 on guard failure', /if \(guardError\) throw new HttpError\(400, guardError\)/.test(src));
  const ksrc = readFileSync(join(ROOT, 'src/components/Knowledge.tsx'), 'utf8');
  ok('picker accept attribute present (UI-owned, intentionally untouched per no-UI-change constraint)',
    ksrc.includes('const ACCEPT ='));
}

// ---- helpers: minimal docx (stored zip) / pdf builders ----
function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (~c) >>> 0;
}
function buildDocx(paragraph) {
  const files = [
    ['[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body></w:document>`],
  ].map(([name, xml]) => ({ name, data: Buffer.from(xml, 'utf8') }));
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nb = Buffer.from(f.name, 'utf8'), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, f.data);
    central.push({ nb, crc, size: f.data.length, offset });
    offset += lh.length + nb.length + f.data.length;
  }
  const cdStart = offset; let cdSize = 0;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
    h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nb.length, 28); h.writeUInt32LE(c.offset, 42);
    parts.push(h, c.nb); cdSize += h.length + c.nb.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16);
  parts.push(end);
  return Buffer.concat(parts);
}
function buildPdf(text) {
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offs = [0];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ---- summary ----
rmSync(BUILD, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failures:', failures.join(', ')); process.exit(1); }
