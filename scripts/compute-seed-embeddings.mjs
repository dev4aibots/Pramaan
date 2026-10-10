// One-time: compute bge-small-en-v1.5 embeddings for demo seed chunks.
// Run: node scripts/compute-seed-embeddings.mjs  → writes db/seed-demo.json
import { writeFileSync } from 'node:fs';

const DOCS = [
  {
    title: 'Northbridge University — Library Hours Policy',
    mime: 'text/plain',
    chunks: [
      'The Northbridge University Central Library is open Monday to Friday from 8:00 AM to 10:00 PM, and on Saturdays from 9:00 AM to 6:00 PM. The library is closed on Sundays and public holidays.',
      'During examination weeks, the Central Library extends its hours: Monday to Saturday from 7:00 AM to midnight. The 24-hour reading room on the ground floor remains open all night during exams with a valid student ID.',
      'Book borrowing: undergraduates may borrow up to 6 books for 14 days, postgraduates up to 10 books for 30 days. Overdue fines are $0.50 per book per day.',
    ],
  },
  {
    title: 'CS101 — Introduction to Programming (Syllabus)',
    mime: 'text/plain',
    chunks: [
      'CS101 Introduction to Programming is a 4-credit core course for first-year Computer Science students at Northbridge University. Instructor: Dr. Meera Krishnan. Lectures: Mon/Wed/Fri 10:00 AM, Room CS-204.',
      'Grading: assignments 40%, midterm exam 25%, final exam 30%, attendance and participation 5%. Programming assignments are submitted through the department portal before 11:59 PM on due dates.',
      'Prerequisites: none. Students will learn Python, covering variables, control flow, functions, data structures, and basic algorithms. The recommended textbook is "Think Python" (2nd edition), available at the Central Library.',
    ],
  },
  {
    title: 'Northbridge University — Campus Safety Guidelines',
    mime: 'text/plain',
    chunks: [
      'Campus Security operates 24/7 and can be reached at extension 4911 from any campus phone, or +1-555-019-4911 from mobile phones. Blue emergency phones are located every 200 meters along main walkways.',
      'All students must carry their university ID card at all times and show it when asked by security staff. Hostel gates close at 11:00 PM; late entry requires sign-in at the warden office.',
      'In case of fire, use the nearest staircase — never the elevators. Assembly points are marked on the evacuation maps posted in every building lobby.',
    ],
  },
];

const { pipeline } = await import('@huggingface/transformers');
console.log('Loading bge-small-en-v1.5 ...');
const ex = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'q8' });
console.log('Model loaded. Embedding chunks...');

const out = [];
for (const doc of DOCS) {
  const chunks = [];
  for (let i = 0; i < doc.chunks.length; i++) {
    const t = await ex(doc.chunks[i], { pooling: 'cls', normalize: true });
    const v = Array.from(t.data).map((x) => Math.round(x * 1e6) / 1e6);
    chunks.push({ idx: i, content: doc.chunks[i], embedding: v });
    console.log(`embedded ${doc.title} chunk ${i + 1}/${doc.chunks.length}`);
  }
  out.push({ title: doc.title, mime: doc.mime, visibility: 'org', chunks });
}
writeFileSync('db/seed-demo.json', JSON.stringify(out));
console.log('Wrote db/seed-demo.json');
