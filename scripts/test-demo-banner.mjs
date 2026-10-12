// Simple render/gate tests for the demo banner (Worker B).
// No test framework in this repo — runs on plain node using the project's own
// typescript (for TS/JSX transpilation) and react-dom/server (for rendering).
//
// Usage: node scripts/test-demo-banner.mjs
// Exit 0 = all pass, 1 = any failure.

import ts from 'typescript';
import Module from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}

// Transpile a repo TS/TSX file to CJS and load it, with optional require stubs.
// demo.ts is pure env-logic for isDemoMode(); we stub './db' (PGlite would
// otherwise init a database at import) and 'bcryptjs' (unused by the test).
function loadTS(relPath, stubs = {}) {
  const full = path.join(ROOT, relPath);
  const src = fs.readFileSync(full, 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: full,
  });
  const fatal = (diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatal.length) throw new Error(`transpile errors in ${relPath}: ${fatal.map((d) => d.messageText).join('; ')}`);
  const m = new Module(full, null);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  const origRequire = Module.prototype.require.bind(m);
  m.require = (id) => (id in stubs ? stubs[id] : origRequire(id));
  m._compile(outputText, full);
  return m.exports;
}

const demo = loadTS('src/lib/demo.ts', {
  './db': { sql: () => { throw new Error('db stubbed for test'); } },
  bcryptjs: { hash: async () => 'stub' },
});
const DemoBannerMod = loadTS('src/components/DemoBanner.tsx');
const DemoBanner = DemoBannerMod.default;

console.log('isDemoMode() env matrix (real src/lib/demo.ts):');
const saved = process.env.DATABASE_URL;

delete process.env.DATABASE_URL;
check('no DATABASE_URL            -> demo mode ON', demo.isDemoMode() === true);

process.env.DATABASE_URL = '';
check('empty DATABASE_URL         -> demo mode ON', demo.isDemoMode() === true);

process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/pramaan';
check('localhost DATABASE_URL     -> demo mode ON', demo.isDemoMode() === true);

process.env.DATABASE_URL = 'postgres://app:secret@db.example.com:5432/pramaan';
check('external DATABASE_URL      -> demo mode OFF', demo.isDemoMode() === false);

if (saved === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = saved;

console.log('DemoBanner render (react-dom/server):');
const bannerHtml = renderToStaticMarkup(React.createElement(DemoBanner));
check('renders "Demo mode" text', bannerHtml.includes('Demo mode'));
check('renders "data resets periodically"', bannerHtml.includes('data resets periodically'));
check('renders FlaskConical icon (svg)', bannerHtml.includes('<svg'));
check('renders dismiss button with aria-label', bannerHtml.includes('aria-label="Dismiss demo banner"'));

console.log('Layout gate (mirrors src/app/app/layout.tsx: isDemoMode() ? <DemoBanner/> : null):');
function renderShell() {
  const show = demo.isDemoMode();
  return renderToStaticMarkup(
    React.createElement(React.Fragment, null, show ? React.createElement(DemoBanner) : null, React.createElement('main', null, 'app'))
  );
}
delete process.env.DATABASE_URL;
check('demo mode ON  -> banner present in shell', renderShell().includes('data resets periodically'));
process.env.DATABASE_URL = 'postgres://app:secret@db.example.com:5432/pramaan';
check('demo mode OFF -> banner absent from shell', !renderShell().includes('data resets periodically'));
if (saved === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = saved;

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
