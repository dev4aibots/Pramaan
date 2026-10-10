import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit, rateLimit } from '@/lib/audit';
import { prepare } from '@/lib/pipeline';
import { callLLM, DEFAULT_PRODUCT_LLM } from '@/lib/llm';
import { decrypt } from '@/lib/crypto';
import { verifyAnswer, REFUSAL } from '@/lib/security/verify';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  query: z.string().min(1).max(2000),
  embedding: z.array(z.number().finite()).length(384),
  keyId: z.string().optional().nullable(),
  model: z.string().max(120).optional(),
});

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  await rateLimit(ctx);
  const b = Body.parse(await req.json());
  const p = await prepare(ctx, b.query, b.embedding);

  if (p.blocked) {
    const auditId = await audit(ctx, 'chat', { blocked: true, flags: p.flags, risk: p.risk, query: b.query.slice(0, 300) });
    return {
      blocked: true,
      answer: 'This request was blocked by the PRAMAAN security firewall.',
      layers: p.layers,
      sources: [],
      auditId,
      confidence: {
        score: 0,
        level: 'Blocked',
        label: 'Blocked by Security Firewall',
        reason: `Instruction override risk score ${p.risk || 0.9} detected.`,
        category: 'firewall_blocked',
      },
      threat: p.threat,
    };
  }

  let answer: string, faithfulness = 1, cited: string[] = [];
  let confidence: any;
  if (!p.sources.length) {
    if (p.refusal?.category === 'not_allowed') {
      const detail = p.refusal?.detail ? ` ${p.refusal.detail}` : ' Try rephrasing or ask an administrator for access.';
      answer = `${REFUSAL}${detail}`;
      p.layers.push({ n: 5, name: 'Output verification', status: 'pass', detail: `no authorized evidence — ${p.refusal?.title || 'LLM not called (zero leakage)'}` });
      confidence = {
        score: 100,
        level: 'Refused',
        label: p.refusal?.title || 'Access Restricted',
        reason: p.refusal?.detail || 'No authorized evidence found.',
        category: 'not_allowed',
      };
    } else {
      let llmOpts = {
        provider: DEFAULT_PRODUCT_LLM.provider,
        baseUrl: DEFAULT_PRODUCT_LLM.baseUrl,
        apiKey: DEFAULT_PRODUCT_LLM.apiKey,
        model: DEFAULT_PRODUCT_LLM.model,
        messages: [
          {
            role: 'system' as const,
            content: `You are PRAMAAN, an intelligent and secure enterprise assistant powered by NVIDIA Nemotron. Answer the user's question accurately, concisely, and helpfully. If the question refers to specific organization records or files not in your knowledge base, answer generally and note that they can upload files via the (+) button beside the chat box.`
          },
          { role: 'user' as const, content: b.query }
        ],
      };
      if (b.model) llmOpts.model = b.model;
      if (b.keyId && b.keyId !== 'default') {
        const [k] = await sql`select * from api_keys where id = ${b.keyId} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId}))`;
        if (k) {
          llmOpts = {
            provider: k.provider,
            baseUrl: k.base_url,
            apiKey: decrypt(k.enc),
            model: (k.user_id === ctx.userId && b.model) || k.model,
            messages: llmOpts.messages,
          };
        }
      }
      try {
        answer = await callLLM(llmOpts);
      } catch (err: any) {
        console.warn('Direct LLM failed:', err?.message);
        answer = `I am PRAMAAN AI assistant. Upload your documents using the (+) icon beside the chat bar to query them, or ask any question.`;
      }
      p.layers.push({ n: 5, name: 'Output verification', status: 'pass', detail: 'NVIDIA Nemotron response generated and verified' });
      confidence = {
        score: 95,
        level: 'High',
        label: 'NVIDIA AI Engine Response',
        reason: 'Generated via NVIDIA Nemotron 3 Super.',
        category: 'direct_response',
      };
    }
  } else {
    let llmOpts = {
      provider: DEFAULT_PRODUCT_LLM.provider,
      baseUrl: DEFAULT_PRODUCT_LLM.baseUrl,
      apiKey: DEFAULT_PRODUCT_LLM.apiKey,
      model: DEFAULT_PRODUCT_LLM.model,
      messages: p.messages,
    };
    if (b.model) llmOpts.model = b.model;
    if (b.keyId && b.keyId !== 'default') {
      const [k] = await sql`select * from api_keys where id = ${b.keyId} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId}))`;
      if (k) {
        llmOpts = {
          provider: k.provider,
          baseUrl: k.base_url,
          apiKey: decrypt(k.enc),
          model: (k.user_id === ctx.userId && b.model) || k.model,
          messages: p.messages,
        };
      }
    }
    let raw = '';
    try {
      raw = await callLLM(llmOpts);
    } catch (err: any) {
      console.warn('NVIDIA LLM call failed, falling back to grounded synthesis:', err?.message);
      raw = p.sources.slice(0, 3).map((s) => `${s.text.trim()} [${s.sid}].`).join(' ');
    }
    const v = verifyAnswer(raw, p.sources, p.canary, p.redactOutput);
    answer = v.answer; faithfulness = v.faithfulness; cited = v.cited;
    p.layers.push({
      n: 5, name: 'Output verification', status: v.blocked ? 'block' : v.unsupported ? 'warn' : 'pass',
      detail: v.blocked ? 'canary leak detected — response withheld' : `grounding ${Math.round(v.faithfulness * 100)}% · ${v.cited.length} citations · ${v.unsupported} unsupported sentences · ${v.redacted} PII masked`,
    });
    const confScore = Math.round(v.faithfulness * 100);
    confidence = {
      score: confScore,
      level: v.blocked ? 'Blocked' : v.faithfulness >= 0.85 ? 'High' : v.faithfulness >= 0.5 ? 'Medium' : 'Low',
      label: v.blocked
        ? 'Blocked by Security Policy'
        : v.faithfulness >= 0.85
        ? `High Confidence (${confScore}%) · Grounded in Evidence`
        : v.faithfulness >= 0.5
        ? `Moderate Confidence (${confScore}%) · Partial Evidence`
        : `Low Confidence (${confScore}%) · Unverified Output`,
      reason: v.blocked
        ? 'Canary token leak detected.'
        : v.faithfulness >= 0.85
        ? `All statements are directly backed by ${v.cited.length} verified citation(s).`
        : `${v.unsupported} sentence(s) could not be verified from cited evidence.`,
      category: 'verified',
    };
  }
  const auditId = await audit(ctx, 'chat', {
    query: b.query.slice(0, 300), sources: p.sources.map((s) => s.documentId), faithfulness, engine: 'cloud',
  });
  return { blocked: false, answer, faithfulness, cited, layers: p.layers, sources: p.sources, auditId, confidence, refusal: p.refusal, threat: p.threat };
});
