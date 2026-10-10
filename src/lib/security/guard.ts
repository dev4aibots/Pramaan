/** Layer 2 — prompt-injection firewall (queries) + ingest quarantine (chunks). */
type Rule = [RegExp, number, string];

const RULES: Rule[] = [
  [/\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|all|earlier|system|any)\b.{0,40}\b(instructions?|prompts?|rules?|directions?|guardrails?)/i, 0.9, 'instruction_override'],
  [/\b(reveal|show|print|repeat|output|leak|tell me)\b.{0,40}\b(system|hidden|initial|developer|secret)\s+(prompt|message|instructions?|token)/i, 0.9, 'prompt_extraction'],
  [/\byou are now\b|\bpretend (to be|you are)\b|\bdo anything now\b|\bjailbreak\b|\bdeveloper mode\b|\bDAN\b/i, 0.8, 'role_hijack'],
  [/<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<<\/?SYS>>|^\s*(system|assistant)\s*:/im, 0.85, 'chat_template_injection'],
  [/\bas an? (admin|administrator|owner|root|superuser)\b|\bi am (the )?(admin|owner|principal|dean|registrar|ceo)\b|\b(grant|give|elevate|escalate)\b.{0,20}\b(access|permission|privilege|role)/i, 0.6, 'privilege_claim'],
  [/\b(other|all|every|another|each)\s+(users?|members?|students?|employees?|tenants?|patients?)('s|')?\s+(data|records?|results?|files?|documents?|marks|salary|details)/i, 0.4, 'cross_tenant_probe'],
  [/!\[[^\]]*\]\(https?:\/\/[^)]+[?&][^)]*=/i, 0.8, 'markdown_exfiltration'],
  [/\b(base64|rot13|hex|unicode)\b.{0,30}\b(decode|encode|translate)\b/i, 0.4, 'obfuscation'],
  [/[A-Za-z0-9+/]{160,}={0,2}/, 0.4, 'encoded_blob'],
];

const INVISIBLE_G = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const INVISIBLE_T = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/u;

export const QUERY_BLOCK = 0.7;
export const CHUNK_QUARANTINE = 0.8;

export function normalize(s: string) {
  return s.normalize('NFKC').replace(INVISIBLE_G, '');
}

export function scan(text: string) {
  const flags: string[] = [];
  let keep = 1;
  if (INVISIBLE_T.test(text)) { flags.push('invisible_unicode'); keep *= 1 - 0.5; }
  const clean = normalize(text);
  for (const [re, w, name] of RULES) {
    if (re.test(clean)) { flags.push(name); keep *= 1 - w; }
  }
  return { score: +(1 - keep).toFixed(3), flags, clean };
}
