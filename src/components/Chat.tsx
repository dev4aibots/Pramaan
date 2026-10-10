'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Send, ShieldCheck, ShieldAlert, ShieldX, Copy, Check, Cloud, Cpu, Server, Laptop,
  TriangleAlert, ChevronDown, FileText, Loader2, Lock, Database, Info, CheckCircle2,
  Plus, UploadCloud,
} from 'lucide-react';
import { Button, Card, Badge, Textarea, Progress } from './ui';
import { api } from '@/lib/client/api';
import { embed } from '@/lib/client/embed';
import { extractFile } from '@/lib/client/extract';
import { ingest } from '@/lib/client/ingest';
import { getEngine, engineLabel, runLocal, type Engine } from '@/lib/client/engines';

type Layer = { n: number; name: string; status: 'pass' | 'warn' | 'block'; detail: string };
type Source = { sid: string; title: string; text: string; documentId: string; score: number };
type Threat = { score: number; riskPct: number; level: string; flags: string[] };
type Msg = {
  id: number; role: 'user' | 'assistant'; content: string;
  layers?: Layer[]; sources?: Source[]; faithfulness?: number; blocked?: boolean; error?: boolean;
  confidence?: { score: number; level: string; label: string; reason: string; category?: string };
  refusal?: { category: string; title: string; detail: string } | null;
  threat?: Threat;
};

const STAGES = ['Embedding', 'Authorizing', 'Retrieving', 'Generating', 'Verifying'] as const;
type StageState = 'idle' | 'active' | 'done';

const layerIcon = (s: Layer['status']) =>
  s === 'pass' ? <ShieldCheck size={14} className="text-emerald-400" />
  : s === 'warn' ? <ShieldAlert size={14} className="text-amber-400" />
  : <ShieldX size={14} className="text-red-400" />;

const layerBadgeTone = (s: Layer['status']): 'green' | 'amber' | 'red' =>
  s === 'pass' ? 'green' : s === 'warn' ? 'amber' : 'red';

const ENGINE_CHOICES = [
  { icon: ShieldCheck, name: 'Built-in Grounded Extractor', desc: 'Zero cost, instant, offline. Extracts verified facts directly from authorized sources with exact citations [S#].' },
  { icon: Cloud, name: 'Cloud key (BYOK)', desc: 'Fastest. Uses an API key saved under Models & keys. All 5 layers run on the server.' },
  { icon: Cpu, name: 'Browser model', desc: 'Fully private — runs on this device via WebGPU. One-time model download.' },
  { icon: Server, name: 'Ollama', desc: 'Runs on your own machine (localhost:11434). Start Ollama and pull a model first.' },
  { icon: Laptop, name: 'LM Studio', desc: 'Runs on your own machine (localhost:1234). Enable the server + CORS in LM Studio.' },
];

function scrollToEvidence(msgId: number, sid: string, flash: (s: string | null) => void) {
  document.getElementById(`ev-${msgId}-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flash(sid);
  window.setTimeout(() => flash(null), 1800);
}

/** Answer text with clickable [S#] citation chips (two-way linked to evidence cards). */
function AnswerBody({ msgId, content, sources, hotSid, setHotSid }: {
  msgId: number; content: string; sources?: Source[]; hotSid: string | null; setHotSid: (s: string | null) => void;
}) {
  const parts = content.split(/(\[S\d+\])/g);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
      {parts.map((p, i) => {
        const m = p.match(/^\[S(\d+)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const sid = `S${m[1]}`;
        const src = sources?.find((s) => s.sid === sid);
        if (!src) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            onClick={() => scrollToEvidence(msgId, sid, setHotSid)}
            onMouseEnter={() => setHotSid(sid)} onMouseLeave={() => setHotSid(null)}
            onFocus={() => setHotSid(sid)} onBlur={() => setHotSid(null)}
            aria-label={`Citation ${sid} from ${src.title} — jump to evidence`}
            className="mx-0.5 inline-flex min-h-[24px] min-w-[28px] items-center justify-center rounded-md bg-indigo-500/15 px-1 font-mono text-[11px] font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30 transition hover:bg-indigo-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
          >{sid}</button>
        );
      })}
    </div>
  );
}

function SourceCard({ msgId, src, hot }: { msgId: number; src: Source; hot: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      id={`ev-${msgId}-${src.sid}`}
      className={`scroll-mt-4 rounded-xl border p-3 transition-colors ${
        hot ? 'border-indigo-400/60 bg-indigo-500/10 ring-2 ring-indigo-500/30' : 'border-white/5 bg-zinc-950/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <Badge tone="indigo">{src.sid}</Badge>
        <FileText size={13} className="shrink-0 text-zinc-500" aria-hidden />
        <span className="truncate text-xs font-medium text-zinc-200" title={src.title}>{src.title}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-zinc-500">sim {Number(src.score).toFixed(3)}</span>
      </div>
      <p className={`mt-1.5 text-xs leading-relaxed text-zinc-400 ${open ? '' : 'line-clamp-3'}`}>{src.text}</p>
      <button
        onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
      >
        {open ? 'Show less' : 'Show full passage'}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
    </div>
  );
}

function Trace({ layers }: { layers: Layer[] }) {
  const blocked = layers.filter((l) => l.status === 'block').length;
  const warned = layers.filter((l) => l.status === 'warn').length;
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden />
        <span className="font-medium">Security trace</span>
        <Badge tone={blocked ? 'red' : warned ? 'amber' : 'green'}>
          {layers.length} layers{blocked ? ` · ${blocked} blocked` : warned ? ` · ${warned} warning` : ' · all clear'}
        </Badge>
      </summary>
      <ol className="relative mt-3 space-y-3 pl-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-white/10">
        {layers.map((l) => (
          <li key={l.n} className="relative flex items-start gap-3">
            <span className={`z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-zinc-950 ${
              l.status === 'pass' ? 'border-emerald-500/30' : l.status === 'warn' ? 'border-amber-500/30' : 'border-red-500/40'
            }`}>{layerIcon(l.status)}</span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-200">L{l.n} · {l.name}</span>
                <Badge tone={layerBadgeTone(l.status)}>{l.status}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">{l.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Faithfulness({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? 'High' : value >= 0.5 ? 'Partial' : 'Low';
  const bar = value >= 0.8 ? 'bg-emerald-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="mt-3 flex items-center gap-2 text-xs" title="Share of answer sentences grounded in the cited sources">
      <span className="text-zinc-400">Grounding</span>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800" role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Grounding ${pct} percent`}>
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-zinc-300">{pct}%</span>
      <Badge tone={value >= 0.8 ? 'green' : value >= 0.5 ? 'amber' : 'red'}>{tone}</Badge>
    </div>
  );
}

function ConfidenceBanner({ confidence }: {
  confidence: { score: number; level: string; label: string; reason: string; category?: string };
}) {
  const isHigh = confidence.level === 'High' || confidence.score >= 85;
  const isMed = confidence.level === 'Medium' || (confidence.score >= 50 && confidence.score < 85);
  const tone = isHigh ? 'green' : isMed ? 'amber' : 'zinc';

  return (
    <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-xs ${
      isHigh ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200'
        : isMed ? 'border-amber-500/25 bg-amber-500/5 text-amber-200'
        : 'border-white/10 bg-zinc-950/40 text-zinc-300'
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        {isHigh ? <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          : isMed ? <ShieldAlert size={14} className="shrink-0 text-amber-400" />
          : <Info size={14} className="shrink-0 text-zinc-400" />}
        <span className="truncate font-medium">{confidence.label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] tabular-nums text-zinc-400">{confidence.score}%</span>
        <Badge tone={tone as any}>{confidence.level}</Badge>
      </div>
    </div>
  );
}

function SecurityThreatLine({ threat, blocked }: { threat?: Threat; blocked?: boolean }) {
  const score = threat?.score ?? 0;
  const riskPct = threat?.riskPct ?? Math.round(score * 100);
  const level = threat?.level ?? (riskPct >= 80 ? 'Critical' : riskPct >= 40 ? 'Elevated' : riskPct > 5 ? 'Low' : 'Minimal');
  const flags = threat?.flags ?? [];
  const isDanger = blocked || riskPct >= 80;
  const isWarn = !isDanger && riskPct >= 20;

  return (
    <div
      className={`my-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        isDanger
          ? 'border-red-500/40 bg-red-950/40 text-red-200'
          : isWarn
          ? 'border-amber-500/30 bg-amber-950/30 text-amber-200'
          : 'border-emerald-500/25 bg-emerald-950/20 text-emerald-200'
      }`}
      aria-label={`Security Threat Level ${level}, Injection Probability ${riskPct}%`}
    >
      <div className="flex items-center gap-2 font-mono">
        {isDanger ? <ShieldX size={14} className="text-red-400 shrink-0" />
          : isWarn ? <ShieldAlert size={14} className="text-amber-400 shrink-0" />
          : <ShieldCheck size={14} className="text-emerald-400 shrink-0" />}
        <span className="font-semibold text-white/90">Threat Level:</span>
        <span className={isDanger ? 'font-bold text-red-400' : isWarn ? 'font-bold text-amber-400' : 'font-bold text-emerald-400'}>
          {level} ({riskPct}%)
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-300">Injection Risk: <strong className="text-white">{riskPct}%</strong></span>
      </div>
      <div className="flex items-center gap-2">
        {flags.length > 0 ? (
          <span className="text-[11px] text-zinc-400 font-mono">Flags: {flags.join(', ')}</span>
        ) : (
          <span className="text-[11px] text-emerald-300/80 font-mono">Policy: Clean</span>
        )}
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            isDanger ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
              : isWarn ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
          }`}
        >
          {isDanger ? 'BLOCKED' : isWarn ? 'CAUTION' : 'SECURE'}
        </span>
      </div>
    </div>
  );
}

function RefusalCard({
  refusal,
  layers,
  threat,
  goKnowledge,
}: {
  refusal: { category: string; title: string; detail: string };
  layers?: Layer[];
  threat?: Threat;
  goKnowledge?: () => void;
}) {
  const isNotConfig = refusal.category === 'not_configured';
  const isNotAllowed = refusal.category === 'not_allowed';

  return (
    <Card className={isNotAllowed ? 'border-amber-500/30 bg-amber-950/20' : isNotConfig ? 'border-sky-500/30 bg-sky-950/20' : 'border-zinc-700/40 bg-zinc-900/30'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isNotAllowed ? <Lock size={16} className="text-amber-400" />
            : isNotConfig ? <Database size={16} className="text-sky-400" />
            : <Info size={16} className="text-zinc-400" />}
          <h3 className="text-sm font-semibold text-zinc-100">{refusal.title}</h3>
        </div>
        <Badge tone={isNotAllowed ? 'amber' : isNotConfig ? 'indigo' : 'zinc'}>
          {isNotAllowed ? 'Access Restricted' : isNotConfig ? 'Not Configured' : 'Not in Documents'}
        </Badge>
      </div>
      <SecurityThreatLine threat={threat} />
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{refusal.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-white/5 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">Recommended action:</span>
        {isNotConfig && goKnowledge && (
          <button
            onClick={goKnowledge}
            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline font-medium"
          >
            Upload documents in Knowledge Vault →
          </button>
        )}
        {isNotAllowed && <span>Contact an organization administrator or professor to adjust access.</span>}
        {!isNotConfig && !isNotAllowed && <span>Add relevant reference files in Knowledge Vault.</span>}
      </div>
      {!!layers?.length && <Trace layers={layers} />}
    </Card>
  );
}

export default function Chat({ me, goModels, goKnowledge }: { me: any; goModels: () => void; goKnowledge?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const [stages, setStages] = useState<StageState[]>(Array(5).fill('idle'));
  const [engine, setEng] = useState<Engine | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [hotSid, setHotSid] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const stageTimer = useRef<number | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|avi|mkv|webm)$/i)) {
      setMsgs((m) => [
        ...m,
        {
          id: idRef.current++,
          role: 'assistant',
          content: '⚠️ Embedding models will only work for text. If you want to add video MP4 or media, use capable models in Settings.',
          error: true,
        },
      ]);
      return;
    }

    setUploading(true);
    setStatus(`Extracting text from ${file.name}…`);
    try {
      const data = await extractFile(file);
      setStatus(`Embedding and indexing ${file.name}…`);
      const res = await ingest(
        { title: file.name, source: 'chat_upload', mime: file.type || 'text/plain', visibility: 'org', allowedRoles: [] },
        data,
        (p) => setStatus(`Indexing ${file.name} (${p}%)…`)
      );
      setMsgs((m) => [
        ...m,
        {
          id: idRef.current++,
          role: 'assistant',
          content: `📄 **${file.name}** was successfully uploaded and indexed (${res.chunks} passages). You can now ask questions about it directly!`,
          threat: { score: 0, riskPct: 0, level: 'Minimal', flags: [] },
        },
      ]);
    } catch (err: any) {
      setMsgs((m) => [
        ...m,
        {
          id: idRef.current++,
          role: 'assistant',
          content: `Upload failed for ${file.name}: ${err?.message || 'Unknown error'}`,
          error: true,
        },
      ]);
    } finally {
      setUploading(false);
      setStatus('');
    }
  }

  useEffect(() => {
    const f = () => setEng(getEngine());
    f(); window.addEventListener('pramaan-engine', f);
    return () => window.removeEventListener('pramaan-engine', f);
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, status, busy]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); composerRef.current?.querySelector('textarea')?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const markStage = (i: number) =>
    setStages(Array.from({ length: 5 }, (_, k): StageState => (k < i ? 'done' : k === i ? 'active' : 'idle')));
  const finishStages = () => setStages(Array(5).fill('done'));
  const stopStageTimer = () => { if (stageTimer.current) { window.clearInterval(stageTimer.current); stageTimer.current = null; } };

  async function copyText(text: string, id: number) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand('copy'); el.remove();
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
  }

  async function send(preset?: string) {
    const query = (preset ?? q).trim();
    if (!query || busy) return;
    if (!engine) return goModels();
    const id = idRef.current++;
    setQ(''); setBusy(true); setLoadPct(null);
    setMsgs((m) => [...m, { id, role: 'user', content: query }]);
    try {
      setStatus('Embedding your question on this device…');
      markStage(0);
      const [embedding] = await embed([query], true);
      let out: Msg;
      if (engine.kind === 'cloud') {
        // Server runs layers 1–5 in one call; advance the chips in pipeline order while we wait.
        markStage(1);
        stopStageTimer();
        stageTimer.current = window.setInterval(() => {
          setStages((prev) => {
            const i = prev.findIndex((s) => s === 'active');
            if (i < 0 || i >= 4) return prev;
            return prev.map((s, k): StageState => (k <= i ? 'done' : k === i + 1 ? 'active' : 'idle'));
          });
        }, 1500);
        setStatus('Running the 5-layer secure pipeline on the server…');
        const r = await api('/api/chat', { body: { query, embedding, keyId: engine.keyId, model: engine.model } });
        finishStages();
        out = {
          id: idRef.current++, role: 'assistant', content: r.answer, layers: r.layers, sources: r.sources,
          faithfulness: r.faithfulness, blocked: r.blocked, confidence: r.confidence, refusal: r.refusal,
          threat: r.threat,
        };
      } else {
        setStatus('Authorizing & retrieving evidence…');
        markStage(2);
        const p = await api('/api/retrieve', { body: { query, embedding } });
        if (p.blocked || p.answer) {
          finishStages();
          out = {
            id: idRef.current++, role: 'assistant', content: p.answer, layers: p.layers, sources: [],
            blocked: p.blocked, confidence: p.confidence, refusal: p.refusal, threat: p.threat,
          };
        } else {
          setStatus(`Generating locally with ${engineLabel(engine)}…`);
          markStage(3);
          const text = await runLocal(engine, p.messages, (pct, t) => {
            setLoadPct(pct); setStatus(`Loading local model ${pct}% — ${t}`);
          });
          setLoadPct(null);
          setStatus('Verifying answer…');
          markStage(4);
          const v = await api('/api/verify', { body: { auditId: p.auditId, answer: text } });
          finishStages();
          out = {
            id: idRef.current++, role: 'assistant', content: v.answer, layers: [...p.layers, v.layer],
            sources: p.sources, faithfulness: v.faithfulness, blocked: v.blocked, confidence: v.confidence, refusal: null,
            threat: p.threat,
          };
        }
      }
      setMsgs((m) => [...m, out]);
    } catch (e: any) {
      setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', content: e.message || 'Request failed', error: true }]);
    } finally {
      stopStageTimer(); setBusy(false); setStatus(''); setLoadPct(null);
    }
  }

  const examples = me.orgKind === 'team'
    ? ['Is student S1023 eligible for the scholarship?', 'What was my semester result?', 'Summarize the admission policy']
    : ['Summarize my uploaded documents', 'What are the key dates in my contract?', 'Find anything about payment terms'];

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Ask {me.orgName}</h1>
          <p className="text-sm text-zinc-400">Answers use only documents your role is allowed to see.</p>
        </div>
        <button
          onClick={goModels}
          aria-label={engine ? `Current model: ${engineLabel(engine)}. Open Models & keys to change.` : 'No model selected. Open Models & keys to choose one.'}
          title="Open Models & keys"
          className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
        >
          <Badge tone={engine ? 'indigo' : 'amber'}>{engineLabel(engine)}</Badge>
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1" role="log" aria-live="polite" aria-label="Conversation">
        {!msgs.length && (
          <Card className="text-center">
            <ShieldCheck size={28} className="mx-auto text-indigo-400" aria-hidden />
            {!engine ? (
              <>
                <h2 className="mt-2 text-base font-semibold text-zinc-100">Choose an engine to start asking</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
                  PRAMAAN never sends your documents to a model you didn&apos;t pick. Pick one:
                </p>
                <ul className="mx-auto mt-4 max-w-lg space-y-2 text-left">
                  {ENGINE_CHOICES.map((c) => (
                    <li key={c.name} className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-950/60 p-3">
                      <c.icon size={18} className="mt-0.5 shrink-0 text-indigo-400" aria-hidden />
                      <div><p className="text-sm font-medium text-zinc-200">{c.name}</p>
                      <p className="text-xs text-zinc-400">{c.desc}</p></div>
                    </li>
                  ))}
                </ul>
                <Button className="mt-4" onClick={goModels}>Open Models &amp; keys</Button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-400">Try one of these:</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {examples.map((x) => (
                    <button
                      key={x} onClick={() => send(x)} disabled={busy}
                      className="min-h-[36px] rounded-full border border-white/10 px-3 py-1 text-sm text-zinc-300 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
                    >{x}</button>
                  ))}
                </div>
              </>
            )}
          </Card>
        )}

        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[95%] rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white sm:max-w-[80%]">{m.content}</div>
            ) : m.error ? (
              <Card className="border-amber-500/40 bg-amber-950/20" role="alert">
                <div className="flex items-center gap-2 text-amber-300">
                  <TriangleAlert size={16} aria-hidden />
                  <p className="text-sm font-semibold">Something went wrong</p>
                </div>
                <p className="mt-1 text-sm text-amber-200/90">{m.content}</p>
              </Card>
            ) : m.refusal ? (
              <RefusalCard refusal={m.refusal} layers={m.layers} threat={m.threat} goKnowledge={goKnowledge} />
            ) : m.blocked ? (
              <Card className="border-red-500/40 bg-red-950/20" role="alert">
                <div className="mb-1 flex items-center gap-2 text-red-300">
                  <ShieldX size={16} aria-hidden />
                  <h3 className="text-sm font-semibold">Blocked by the PRAMAAN security firewall</h3>
                </div>
                <SecurityThreatLine threat={m.threat} blocked={true} />
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-red-200/90">{m.content}</p>
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-xs font-semibold text-red-200">What you can ask instead</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-200/80">
                    <li>Rephrase without instruction-style wording such as “ignore”, “reveal” or “override”.</li>
                    <li>Ask about documents your role can access — an admin can grant access to more.</li>
                    <li>Upload the relevant document in Knowledge first, then ask.</li>
                  </ul>
                </div>
                {!!m.layers?.length && <Trace layers={m.layers} />}
              </Card>
            ) : (
              <Card>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">PRAMAAN</span>
                  <button
                    onClick={() => copyText(m.content, m.id)}
                    aria-label={copiedId === m.id ? 'Copied' : 'Copy answer'}
                    title="Copy answer"
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    {copiedId === m.id ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  </button>
                </div>
                <SecurityThreatLine threat={m.threat} />
                <AnswerBody msgId={m.id} content={m.content} sources={m.sources} hotSid={hotSid} setHotSid={setHotSid} />
                {m.confidence && <ConfidenceBanner confidence={m.confidence} />}
                {typeof m.faithfulness === 'number' && !!m.sources?.length && <Faithfulness value={m.faithfulness} />}
                {!!m.sources?.length && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Evidence · {m.sources.length} source{m.sources.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-2">
                      {m.sources.map((s) => <SourceCard key={s.sid} msgId={m.id} src={s} hot={hotSid === s.sid} />)}
                    </div>
                  </div>
                )}
                {!!m.layers?.length && <Trace layers={m.layers} />}
              </Card>
            )}
          </div>
        ))}

        {busy && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-3" aria-live="polite" aria-label="Pipeline progress">
            <ol className="flex flex-wrap items-center gap-1.5">
              {STAGES.map((s, i) => (
                <li key={s} className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
                    stages[i] === 'done' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                    : stages[i] === 'active' ? 'bg-indigo-500/15 text-indigo-200 ring-indigo-500/40'
                    : 'bg-zinc-800/60 text-zinc-500 ring-white/10'
                  }`}>
                    {stages[i] === 'done' ? <Check size={11} aria-hidden />
                      : stages[i] === 'active' ? <Loader2 size={11} className="animate-spin" aria-hidden />
                      : <span className="tabular-nums" aria-hidden>{i + 1}</span>}
                    {s}
                  </span>
                  {i < STAGES.length - 1 && <span className="text-zinc-700" aria-hidden>→</span>}
                </li>
              ))}
            </ol>
            {(status || loadPct !== null) && (
              <div className="mt-2">
                {status && <p className="animate-pulse text-xs text-zinc-400">{status}</p>}
                {loadPct !== null && <div className="mt-1.5"><Progress value={loadPct} label="Loading local model" /></div>}
              </div>
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="mt-4 pb-[env(safe-area-inset-bottom)]">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".pdf,.txt,.docx,.csv,.xlsx,.json,.md,.html"
          onChange={handleFileSelect}
        />
        <div className="flex items-end gap-2" ref={composerRef}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading}
            aria-label="Upload document or knowledge file (+)"
            title="Upload PDF, TXT, DOCX, CSV or knowledge document (+)"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900/90 text-indigo-400 shadow-sm transition hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 active:scale-95 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin text-indigo-400" /> : <Plus size={20} />}
          </button>
          <Textarea
            rows={2} value={q} maxLength={2000} disabled={busy || uploading}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            aria-label="Ask a question"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="max-h-48 resize-y"
          />
          <Button onClick={() => send()} disabled={busy || uploading || !q.trim()} aria-label="Send question" className="shrink-0 self-end px-4 py-3">
            <Send size={16} aria-hidden />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">Ctrl/⌘ K</kbd> to focus ·
          answers cite only documents your role can access · all queries audited
        </p>
      </div>
    </div>
  );
}
