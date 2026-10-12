import { classifyUpload } from '@/lib/files/policy';

export type Extracted = { text?: string; rows?: { text: string; subject: string | null }[] };

const rowText = (r: Record<string, any>) =>
  Object.entries(r).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' | ');

export async function extractFile(file: File, subjectColumn?: string): Promise<Extracted> {
  // File-type policy is enforced here AND on the server (api/documents POST).
  // Media/legacy-doc/unsupported types throw before any parsing is attempted.
  const verdict = classifyUpload(file.name, file.type);
  if (!verdict.ok) throw new Error(verdict.error ?? 'Unsupported file type.');

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
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    const XLSX: any = await import('xlsx');
    const wb = XLSX.read(ext === 'csv' ? await file.text() : await buf(), { type: ext === 'csv' ? 'string' : 'array' });
    const rows: Extracted['rows'] = [];
    for (const name of wb.SheetNames) {
      const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      for (const r of data) {
        rows.push({ text: `[${name}] ${rowText(r)}`, subject: subjectColumn && r[subjectColumn] !== '' ? String(r[subjectColumn]) : null });
      }
    }
    return { rows };
  }
  if (['html', 'htm'].includes(ext)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    return { text: doc.body?.innerText || doc.body?.textContent || '' };
  }
  return { text: await file.text() }; // txt, md, extensionless plain text
}
