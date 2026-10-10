export type Extracted = { text?: string; rows?: { text: string; subject: string | null }[] };

const rowText = (r: Record<string, any>) =>
  Object.entries(r).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' | ');

export async function extractFile(file: File, subjectColumn?: string): Promise<Extracted> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const buf = () => file.arrayBuffer();

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await buf()));
    const { text } = await extractText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join('\n\n') : text };
  }
  if (ext === 'docx') {
    const m: any = await import('mammoth');
    const mammoth = m.default ?? m;
    const r = await mammoth.extractRawText({ arrayBuffer: await buf() });
    return { text: r.value };
  }
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) {
    const XLSX: any = await import('xlsx');
    const wb = XLSX.read(ext === 'csv' || ext === 'tsv' ? await file.text() : await buf(), { type: ext === 'csv' || ext === 'tsv' ? 'string' : 'array' });
    const rows: Extracted['rows'] = [];
    for (const name of wb.SheetNames) {
      const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      for (const r of data) {
        rows.push({ text: `[${name}] ${rowText(r)}`, subject: subjectColumn && r[subjectColumn] !== '' ? String(r[subjectColumn]) : null });
      }
    }
    return { rows };
  }
  if (ext === 'json') {
    const j = JSON.parse(await file.text());
    if (Array.isArray(j) && j.every((x) => x && typeof x === 'object')) {
      return { rows: j.map((r) => ({ text: rowText(r), subject: subjectColumn && r[subjectColumn] != null ? String(r[subjectColumn]) : null })) };
    }
    return { text: JSON.stringify(j, null, 2) };
  }
  if (['html', 'htm'].includes(ext)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    return { text: doc.body?.innerText || doc.body?.textContent || '' };
  }
  if (file.type.startsWith('image/')) throw new Error('Images/OCR are not supported yet — export text or PDF with a text layer');
  return { text: await file.text() }; // txt, md, code, xml, log, etc.
}
