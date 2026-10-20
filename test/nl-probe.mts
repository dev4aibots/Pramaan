/**
 * Coordinator probe suite for the demo natural-language answers — the
 * ROUND-2 acceptance cases. These use the EXACT probe texts/questions
 * that exposed round-1 failures (single-sentence uploads echoed verbatim,
 * cross-document person fabrication, off-target sentence stuffing,
 * yes/no questions answered with adjacent facts, and a no-coverage
 * question answered from an unrelated "price" chunk).
 *
 * Run from the project root:
 *   node --import ./test/setup.mjs test/nl-probe.mts
 *
 * Per-case assertions: required facts present, fabricated facts absent
 * ("Priya Sharma" in any ZEBRA-9 answer is an automatic failure), the
 * hard echo gate (maxRun <= 8 AND ratio <= 0.5), and T5 must be null.
 */
import assert from 'node:assert/strict';

const { retrieveDemo } = await import('@/lib/demo-retrieval.ts');
const { composeAnswer } = await import('@/lib/compose.ts');

const zebra = [{ title: 'zebra9.txt', content: "Project ZEBRA-9's launch code is 4471 and its owner is Priya Nair." }];
const zebraB = [...zebra, { title: 'zebra9b.txt', content: 'The ZEBRA-9 review meeting will be held in Jaipur on 12 November 2026. The meeting is chaired by Dev Shah and covers the launch readiness checklist.' }];

type ProbeCase = {
  id: string;
  query: string;
  docs?: { title: string; content: string }[];
  expect: string[] | null; // substrings the answer must contain; null => no coverage
  forbid?: string[]; // substrings the answer must NOT contain
};

const CASES: ProbeCase[] = [
  { id: 'T1a', query: "What is Project ZEBRA-9's launch code?", docs: zebra, expect: ['4471'], forbid: ['Priya Nair', 'Priya Sharma'] },
  { id: 'T1b', query: 'Who is the owner of Project ZEBRA-9?', docs: zebra, expect: ['Priya Nair'], forbid: ['4471', 'Priya Sharma'] },
  { id: 'T2a', query: 'Who leads ZEBRA-9 and what code do they use to launch?', docs: zebra, expect: ['Priya Nair', '4471'], forbid: ['Priya Sharma'] },
  { id: 'T2b', query: 'Tell me about ZEBRA-9', docs: zebra, expect: ['ZEBRA-9', '4471', 'Priya Nair'], forbid: ['Priya Sharma'] },
  { id: 'T3', query: 'Who owns ZEBRA-9 and where will its review meeting be held?', docs: zebraB, expect: ['Priya Nair', 'Jaipur'], forbid: ['Priya Sharma'] },
  { id: 'T4a', query: 'How much paid leave do NovaTech employees get each year?', expect: ['21 days'], forbid: ['health insurance', 'All-hands', 'Priya Sharma'] },
  { id: 'T4b', query: "What does CloudSync Pro's Pro plan cost and what does it include?", expect: ['$29', '2 TB'], forbid: ['money-back'] },
  { id: 'T4c', query: 'Did NovaTech make a profit in Q3 2026?', expect: ['Yes', '$1.1M', 'profit'], forbid: ['Gross margin'] },
  { id: 'T5', query: "What is NovaTech's current stock price on the NSE?", expect: null },
];

let failures = 0;
for (const c of CASES) {
  const r = retrieveDemo(c.query, c.docs);
  const composed = r ? composeAnswer(c.query, r.passages) : null;
  console.log(`--- ${c.id}: ${c.query}`);
  if (!c.expect) {
    console.log(`    A: <no coverage> (retrieval=${r ? 'hit' : 'null'}, composed=${composed ? 'hit' : 'null'})`);
    try {
      assert.equal(composed, null, 'no-coverage question must not produce an answer');
      console.log('    PASS: correctly returned no coverage');
    } catch (e) {
      failures++;
      console.log(`    FAIL: ${(e as Error).message}`);
      if (composed) console.log(`    unexpected answer: ${composed.answer}`);
    }
    continue;
  }
  if (!composed) {
    failures++;
    console.log('    FAIL: no answer composed');
    continue;
  }
  console.log(`    A: ${composed.answer}`);
  console.log(`    echo: maxRun=${composed.echo.maxRun} ratio=${composed.echo.ratio.toFixed(3)} | sources: ${composed.sources.map((s) => `${s.sid}:${s.title}`).join(', ')}`);
  try {
    for (const frag of c.expect) {
      assert.ok(composed.answer.includes(frag), `answer must contain ${JSON.stringify(frag)}`);
    }
    for (const frag of c.forbid || []) {
      assert.ok(!composed.answer.includes(frag), `answer must NOT contain ${JSON.stringify(frag)}`);
    }
    assert.ok(composed.echo.maxRun <= 8, `echo maxRun ${composed.echo.maxRun} exceeds 8`);
    assert.ok(composed.echo.ratio <= 0.5, `echo ratio ${composed.echo.ratio} exceeds 0.5`);
    const cited = [...composed.answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
    assert.ok(cited.length >= 1, 'answer must carry at least one [S#] citation');
    for (const sid of cited) assert.ok(composed.sources.some((s) => s.sid === sid), `citation ${sid} has no source`);
    console.log('    PASS');
  } catch (e) {
    failures++;
    console.log(`    FAIL: ${(e as Error).message}`);
  }
}
console.log(failures ? `${failures} CASE(S) FAILED` : 'ALL PROBE CASES PASS');
process.exit(failures ? 1 : 0);
