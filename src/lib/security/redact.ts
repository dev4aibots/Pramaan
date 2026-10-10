/** Layer 4 — PII shield. Applied to context for non-privileged users and to model output. */
const PATTERNS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[AADHAAR/ID]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD/ACCOUNT]'],
  [/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)\d{3,4}[\s-]?\d{4}\b/g, '[PHONE]'],
];

export function redact(text: string) {
  let count = 0;
  let out = text;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, () => { count++; return label; });
  }
  return { text: out, count };
}
