// Builds real demo seed files: a PDF and a DOCX generated from the seed texts.
// Run: node scripts/build-demo-seeds.mjs
// Output: db/demo/novatech-handbook.pdf, db/demo/cloudsync-manual.docx
// These are read + text-extracted at seed time (same libs as the browser client:
// unpdf for PDF, mammoth for DOCX), proving multi-format ingestion works.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join(process.cwd(), 'db', 'demo');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- minimal PDF writer ---------------- */

function pdfEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(text, max = 88) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function buildPdf(title, paragraphs) {
  const W = 612, H = 792, M = 56, FS = 12, LH = 17;
  const pages = [];
  let lines = [{ text: title, size: 18, bold: true }, { text: '', size: 12 }];
  for (const p of paragraphs) {
    for (const l of wrapLine(p)) lines.push({ text: l, size: FS });
    lines.push({ text: '', size: FS });
  }
  const perPage = Math.floor((H - 2 * M) / LH);
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));

  const objs = [];
  // 1: catalog, 2: pages, then per page: page obj + content obj, then font
  let content = `BT /F1 12 Tf\n`;
  const pageObjs = [];
  pages.forEach((pg, pi) => {
    let stream = 'BT\n/F1 12 Tf\n';
    let y = H - M;
    for (const l of pg) {
      const size = l.size || 12;
      stream += `${size} 0 0 ${size} ${M} ${y} Tm\n(${pdfEscape(l.text)}) Tj\n`;
      y -= l.size === 18 ? 26 : LH;
    }
    stream += 'ET';
    pageObjs.push({ stream, index: pi });
  });

  const nPages = pages.length;
  // object numbering: 1 catalog, 2 pages, 3..(3+nPages*2-1) page+content pairs, last = font
  const fontObjNum = 3 + nPages * 2;
  const kids = [];
  for (let i = 0; i < nPages; i++) kids.push(`${3 + i * 2} 0 R`);

  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`;
  pageObjs.forEach((p, i) => {
    const pageNum = 3 + i * 2, contentNum = 4 + i * 2;
    objs[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objs[contentNum] = `<< /Length ${Buffer.byteLength(p.stream, 'utf8')} >>\nstream\n${p.stream}\nendstream`;
  });
  objs[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= fontObjNum; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${fontObjNum + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= fontObjNum; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${fontObjNum + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

/* ---------------- minimal DOCX writer (raw ZIP) ---------------- */

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildDocx(title, paragraphs) {
  const paras = [
    `<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r></w:p>`,
    ...paragraphs.flatMap((p) =>
      wrapLine(p, 100).map((l) =>
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(l)}</w:t></w:r></w:p>`
      )
    ),
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ];

  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const nameBuf = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ---------------- seed content ---------------- */

const HANDBOOK_TITLE = 'NovaTech Employee Handbook 2026';
const HANDBOOK_PARAS = [
  'NovaTech Solutions Pvt. Ltd. was founded in 2019 and is headquartered in Bengaluru, India. The company currently employs 240 people across engineering, design, sales, and operations. Our mission is to build reliable cloud infrastructure for small businesses.',
  'Leave policy: every full-time employee receives 21 days of annual paid leave and 12 days of sick leave per calendar year. New joiners serve a probation period of 6 months, during which 1 day of leave accrues per month. Unused annual leave up to 5 days may be carried forward to the next year.',
  'Remote work policy: employees may work from home up to 3 days per week with manager approval. Core collaboration hours are 11:00 AM to 4:00 PM IST, during which all team members must be reachable. All-hands meetings are held on the first Monday of each month and are mandatory in-office.',
  'Benefits: NovaTech provides health insurance coverage of Rs. 5 lakh per employee per year, covering spouse and two children. Employees receive an annual performance bonus of up to 15% of CTC. The company also offers a learning budget of Rs. 25,000 per year for courses and certifications.',
];

const MANUAL_TITLE = 'CloudSync Pro — Product Manual v4.2';
const MANUAL_PARAS = [
  'CloudSync Pro is a cloud backup and file-synchronization service by NovaTech. It keeps your files synced across desktop, mobile, and web with end-to-end encryption. Key features include automatic version history (30 days), selective sync folders, and shared team workspaces with granular permissions.',
  'Pricing: the Starter plan is free and includes 5 GB of storage for one user. The Pro plan costs $29 per month and includes 2 TB of storage, priority support, and 90-day version history. The Team plan costs $99 per month and includes 10 TB of pooled storage, SSO/SAML login, and a dedicated account manager.',
  'Refund policy: CloudSync Pro offers a 30-day money-back guarantee on all paid plans. If you cancel within 30 days of purchase, you receive a full refund to the original payment method within 7 business days. To request a refund, email support@cloudsync.pro with your account email and order ID. Refunds are not available after 30 days except where required by law.',
  'Troubleshooting: Error E-101 (connection failed) — restart the desktop app and check your internet connection. Error E-204 (upload blocked) — allow outbound traffic on port 443 in your firewall. If sync appears stuck, pause and resume sync from the tray menu; this re-indexes pending files. For unresolved issues contact support@cloudsync.pro with your log file.',
];

fs.writeFileSync(path.join(OUT, 'novatech-handbook.pdf'), buildPdf(HANDBOOK_TITLE, HANDBOOK_PARAS));
fs.writeFileSync(path.join(OUT, 'cloudsync-manual.docx'), buildDocx(MANUAL_TITLE, MANUAL_PARAS));
console.log('Wrote:', path.join(OUT, 'novatech-handbook.pdf'));
console.log('Wrote:', path.join(OUT, 'cloudsync-manual.docx'));
