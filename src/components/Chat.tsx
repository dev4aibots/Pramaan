'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Button, Card, Badge, Textarea } from './ui';
import { api } from '@/lib/client/api';
import { embed } from '@/lib/client/embed';
import { getEngine, engineLabel, runLocal, type Engine } from '@/lib/client/engines';

type Layer = { n: number; name: string; status: 'pass' | 'warn' | 'block'; detail: string };
type Msg = { role: 'user' | 'assistant'; content: string; layers?: Layer[]; sources?: any[]; faithfulness?: number; blocked?: boolean };

const icon = (s: string) => (s === 'pass' ? <ShieldCheck size={14} className="text-emerald-400" /> : s === 'warn' ? <ShieldAlert size={14} className="text-amber-400" /> : <ShieldX size={14} className="text-red-400" />);

export default function Chat({ me, goModels }: { me: any; goModels: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [engine, setEng] = useState<Engine | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = () => setEng(getEngine());
    f(); window.addEventListener('pramaan-engine', f);
    return () => window.removeEventListener('pramaan-engine', f);
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, status]);

  async function send() {
    const query = q.trim();
    if (!query || busy) return;
    if (!engine) return goModels();
    setQ(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: query }]);
    try {
      setStatus('Embedding your question on this device…');
      const [embedding] = await embed([query], true);
      let out: Msg;
      if (engine.kind === 'cloud') {
        setStatus('Running 5-layer secure pipeline…');
        const r = await api('/api/chat', { body: { query, embedding, keyId: engine.keyId, model: engine.model } });
        out = { role: 'assistant', content: r.answer, layers: r.layers, sources: r.sources, faithfulness: r.faithfulness, blocked: r.blocked };
      } else {
        setStatus('Authorizing & retrieving evidence…');
        const p = await api('/api/retrieve', { body: { query, embedding } });
        if (p.blocked || p.answer) {
          out = { role: 'assistant', content: p.answer, layers: p.layers, sources: [], blocked: p.blocked };
        } else {
          setStatus(`Generating locally with ${engineLabel(engine)}…`);
          const text = await runLocal(engine, p.messages, (pct, t) => setStatus(`Loading model ${pct}% — ${t}`));
          setStatus('Verifying answer…');
          const v = await api('/api/verify', { body: { auditId: p.auditId, answer: text } });
          out = { role: 'assistant', content: v.answer, layers: [...p.layers, v.layer], sources: p.sources, faithfulness: v.faithfulness, blocked: v.blocked };
        }
      }
      setMsgs((m) => [...m, out]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally { setBusy(false); setStatus(''); }
  }

  const examples = me.orgKind === 'team'
    ? ['Is student S1023 eligible for the scholarship?', 'What was my semester result?', 'Summarize the admission policy']
    : ['Summarize my uploaded documents', 'What are the key dates in my contract?', 'Find anything about payment terms'];

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-xl font-semibold">Ask {me.orgName}</h1><p className="text-sm text-zinc-400">Answers use only documents your role is allowed to see.</p></div>
        <button onClick={goModels}><Badge tone={engine ? 'indigo' : 'amber'}>{engineLabel(engine)}</Badge></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {!msgs.length && (
          <Card className="text-center">
            <ShieldCheck className="mx-auto text-indigo-400" />
            <p className="mt-2 text-sm text-zinc-400">Try one of these:</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {examples.map((x) => <button key={x} onClick={() => setQ(x)} className="rounded-full border border-white/10 px-3 py-1 text-sm text-zinc-300 hover:bg-white/5">{x}</button>)}
            </div>
          </Card>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[80%] rounded-2xl bg-indigo-600 px-4 py-2 text-sm">{m.content}</div>
            ) : (
              <Card className={m.blocked ? 'border-red-500/40' : ''}>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                {typeof m.faithfulness === 'number' && m.sources?.length ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                    Grounding
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full ${m.faithfulness >= 0.7 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${m.faithfulness * 100}%` }} /></div>
                    {Math.round(m.faithfulness * 100)}%
                  </div>
                ) : null}
                {!!m.sources?.length && (
                  <details className="mt-3 text-sm"><summary className="cursor-pointer text-zinc-400">Evidence ({m.sources.length})</summary>
                    <div className="mt-2 space-y-2">
                      {m.sources.map((s: any) => (
                        <div key={s.sid} className="rounded-xl border border-white/5 bg-zinc-950/60 p-3">
                          <div className="mb-1 flex items-center gap-2"><Badge tone="indigo">{s.sid}</Badge><span className="truncate text-xs text-zinc-300">{s.title}</span><span className="ml-auto text-xs text-zinc-500">sim {s.score}</span></div>
                          <p className="line-clamp-4 text-xs text-zinc-400">{s.text}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {!!m.layers?.length && (
                  <details className="mt-2 text-sm"><summary className="cursor-pointer text-zinc-400">Security trace</summary>
                    <ul className="mt-2 space-y-1">
                      {m.layers.map((l) => <li key={l.n} className="flex items-start gap-2 text-xs">{icon(l.status)}<span className="font-medium text-zinc-300">L{l.n} {l.name}</span><span className="text-zinc-500">— {l.detail}</span></li>)}
                    </ul>
                  </details>
                )}
              </Card>
            )}
          </div>
        ))}
        {status && <div className="animate-pulse text-sm text-zinc-400">{status}</div>}
        <div ref={end} />
      </div>
      <div className="mt-4 flex gap-2">
        <Textarea rows={2} value={q} placeholder="Ask a question… (Enter to send)" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button onClick={send} disabled={busy || !q.trim()}><Send size={16} /></Button>
      </div>
    </div>
  );
}
