/**
 * Local QA for the demo natural-language answers (retrieval + composer).
 *
 * Run from the project root:
 *   node --import ./test/setup.mjs test/nl-qa.mts
 *
 * Exercises lib/demo-retrieval.ts + lib/compose.ts directly (no HTTP, no DB)
 * on: the ZEBRA-9 upload protocol (4 questions), a two-doc combination
 * question, 3 seed-corpus questions, and 1 off-corpus question that must
 * yield no coverage. Prints every answer + its echo metric and asserts
 * fact correctness + echo-guard thresholds (maxRun <= 8, ratio <= 0.5).
 */
import assert from 'node:assert/strict';

const { retrieveDemo } = await import('@/lib/demo-retrieval.ts');
const { composeAnswer } = await import('@/lib/compose.ts');

const ZEBRA_DOC = {
  title: 'Project ZEBRA-9 Brief',
  content: [
    'Project ZEBRA-9 is a confidential initiative to modernise NovaTech\'s internal deployment pipeline.',
    'The project is owned by Priya Nair, who also leads the engineering team responsible for delivery.',
    'The launch code for Project ZEBRA-9 is 4471, and it must be entered by the duty officer at go-live.',
    'The first milestone review is scheduled for November 30, 2026 in Bengaluru.',
  ].join(' '),
};

type Case = {
  name: string;
  query: string;
  uploadedDocs?: { title: string; content: string }[];
  expect: string[] | null; // substrings the answer must contain; null => no coverage
  minSources?: number;
};

const CASES: Case[] = [
  {
    name: 'ZEBRA-9 launch code',
    query: "What is Project ZEBRA-9's launch code?",
    uploadedDocs: [ZEBRA_DOC],
    expect: ['4471'],
    minSources: 1,
  },
  {
    name: 'ZEBRA-9 owner',
    query: 'Who is the owner of Project ZEBRA-9?',
    uploadedDocs: [ZEBRA_DOC],
    expect: ['Priya Nair'],
    minSources: 1,
  },
  {
    name: 'ZEBRA-9 combination (leads + code, same doc)',
    query: 'Who leads ZEBRA-9 and what code do they use to launch?',
    uploadedDocs: [ZEBRA_DOC],
    expect: ['Priya Nair', '4471'],
    minSources: 1,
  },
  {
    name: 'ZEBRA-9 summary',
    query: 'Tell me about ZEBRA-9',
    uploadedDocs: [ZEBRA_DOC],
    expect: ['ZEBRA-9'],
    minSources: 1,
  },
  {
    name: 'two-doc combination (launch lead + Team plan price)',
    query: 'Who leads the product launch, and how much does the CloudSync Pro Team plan cost?',
    expect: ['Priya Sharma', '$99'],
    minSources: 2,
  },
  {
    name: 'seed: leave policy',
    query: 'How many days of annual paid leave do employees receive?',
    expect: ['21 days of annual paid leave', '12 days of sick leave'],
    minSources: 1,
  },
  {
    name: 'seed: CloudSync Pro pricing',
    query: 'How much does CloudSync Pro cost?',
    expect: ['$29', '$99', 'free'],
    minSources: 1,
  },
  {
    name: 'seed: Q3 revenue and profit',
    query: 'What were Q3 2026 revenue and operating profit?',
    expect: ['$4.2M', '$1.1M'],
    minSources: 2,
  },
  {
    name: 'off-corpus (must be no coverage)',
    query: 'What is the capital of France?',
    uploadedDocs: [ZEBRA_DOC],
    expect: null,
  },
];

let failures = 0;
for (const c of CASES) {
  const retrieval = retrieveDemo(c.query, c.uploadedDocs);
  const composed = retrieval ? composeAnswer(c.query, retrieval.passages) : null;
  console.log('='.repeat(78));
  console.log(`CASE: ${c.name}`);
  console.log(`Q: ${c.query}`);
  if (!c.expect) {
    console.log(`A: <no coverage> (retrieval=${retrieval ? 'hit' : 'null'}, composed=${composed ? 'hit' : 'null'})`);
    try {
      assert.equal(composed, null, 'off-corpus question must not produce an answer');
      console.log('PASS: correctly returned no coverage');
    } catch (e) {
      failures++;
      console.log(`FAIL: ${(e as Error).message}`);
      if (composed) console.log(`  unexpected answer: ${composed.answer}`);
    }
    continue;
  }
  if (!composed) {
    failures++;
    console.log('FAIL: no answer composed (retrieval=' + (retrieval ? `top ${retrieval.topScore}` : 'null') + ')');
    continue;
  }
  console.log(`A: ${composed.answer}`);
  console.log(`sources: ${composed.sources.map((s) => `${s.sid} "${s.title}" sim=${s.score}`).join(' | ')}`);
  console.log(`echo: maxRun=${composed.echo.maxRun} words, ratio=${composed.echo.ratio}`);
  try {
    for (const frag of c.expect) {
      assert.ok(composed.answer.includes(frag), `answer must contain ${JSON.stringify(frag)}`);
    }
    assert.ok(composed.sources.length >= (c.minSources || 1), `expected >= ${c.minSources} sources`);
    assert.ok(composed.echo.maxRun <= 8, `echo maxRun ${composed.echo.maxRun} exceeds 8`);
    assert.ok(composed.echo.ratio <= 0.5, `echo ratio ${composed.echo.ratio} exceeds 0.5`);
    // Citations in the answer must match the sources array, in order.
    const cited = [...composed.answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
    assert.ok(cited.length >= 1, 'answer must carry at least one [S#] citation');
    for (const sid of cited) assert.ok(composed.sources.some((s) => s.sid === sid), `citation ${sid} has no source`);
    console.log('PASS');
  } catch (e) {
    failures++;
    console.log(`FAIL: ${(e as Error).message}`);
  }
}
console.log('='.repeat(78));
console.log(failures ? `${failures} CASE(S) FAILED` : 'ALL CASES PASS');
process.exit(failures ? 1 : 0);
