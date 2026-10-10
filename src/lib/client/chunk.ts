/** Structure-aware recursive chunker: paragraphs → sentences, ~900 chars, 150 overlap, heading carried forward. */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = '';
  let heading = '';
  const push = () => {
    const c = buf.trim();
    if (c.length > 20) chunks.push(heading && !c.startsWith(heading) ? `${heading}\n${c}` : c);
    buf = c.slice(-overlap);
  };
  for (const p of paras) {
    if (/^(#{1,6}\s|[A-Z][A-Z0-9 .:-]{3,80}$)/.test(p.trim()) && p.length < 120) heading = p.trim().replace(/^#+\s*/, '');
    const pieces = p.length > size ? p.split(/(?<=[.!?])\s+/) : [p];
    for (const piece of pieces) {
      if ((buf + '\n' + piece).length > size && buf.length > overlap) push();
      if (piece.length > size) {
        for (let i = 0; i < piece.length; i += size - overlap) { buf = piece.slice(i, i + size); push(); }
      } else buf += (buf ? '\n' : '') + piece;
    }
  }
  if (buf.trim().length > overlap || !chunks.length) { const c = buf.trim(); if (c) chunks.push(heading && !c.startsWith(heading) ? `${heading}\n${c}` : c); }
  return chunks;
}
