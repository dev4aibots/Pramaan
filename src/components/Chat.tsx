'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Send, ShieldCheck, ShieldAlert, ShieldX, Copy, Check, Cloud, Cpu, Server, Laptop,
  TriangleAlert, ChevronDown, FileText, Loader2, Lock, Database, Info, CheckCircle2,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { embedSmart } from '@/lib/client/embed';
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
  s === 'pass' ? <ShieldCheck size={14} className="text-[#00c950]" />
  : s === 'warn' ? <ShieldAlert size={14} className="text-[#f5a524]" />
  : <ShieldX size={14} className="text-[#f31260]" />;

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
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#ededed]">
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
            className="mx-0.5 inline-flex min-h-[24px] items-center rounded border border-[#262626] bg-[#0a0a0a] px-1.5 font-mono text-[11px] font-medium text-[#ededed] transition hover:border-[#404040] hover:bg-[#111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373]"
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
      className={`scroll-mt-4 rounded-lg border bg-[#0a0a0a] p-3 transition-colors ${
        hot ? 'border-[#737373]' : 'border-[#262626]'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-medium text-[#ededed]">{src.sid}</span>
        <FileText size={13} className="shrink-0 text-[#666]" aria-hidden />
        <span className="truncate text-xs font-medium text-[#ededed]" title={src.title}>{src.title}</span>
        <span className="tnum ml-auto shrink-0 font-mono text-[11px] text-[#666]">sim {Number(src.score).toFixed(3)}</span>
      </div>
      <p className={`mt-1.5 text-xs leading-relaxed text-[#a1a1a1] ${open ? '' : 'line-clamp-3'}`}>{src.text}</p>
      <button
        onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-medium text-[#a1a1a1] hover:text-[#ededed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373]"
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
  const pillTone = blocked ? 'pill-red' : warned ? 'pill-amber' : 'pill-green';
  return (
    <details className="group mt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-[#a1a1a1] hover:text-[#ededed] [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden />
        <span className="font-medium">Security trace</span>
        <span className={`pill ${pillTone}`}>
          <span className="dot" aria-hidden />
          {layers.length} layers{blocked ? ` · ${blocked} blocked` : warned ? ` · ${warned} warning` : ' · all clear'}
        </span>
      </summary>
      <ol className="relative mt-3 space-y-3 pl-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-[#262626]">
        {layers.map((l) => (
          <li key={l.n} className="relative flex items-start gap-3">
            <span className="z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#262626] bg-[#0a0a0a]">{layerIcon(l.status)}</span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#ededed]">L{l.n} · {l.name}</span>
                <span className={`pill ${l.status === 'pass' ? 'pill-green' : l.status === 'warn' ? 'pill-amber' : 'pill-red'}`}>
                  <span className="dot" aria-hidden />
                  {l.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[#666]">{l.detail}</p>
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
  const bar = value >= 0.8 ? 'bg-[#00c950]' : value >= 0.5 ? 'bg-[#f5a524]' : 'bg-[#f31260]';
  const pillTone = value >= 0.8 ? 'pill-green' : value >= 0.5 ? 'pill-amber' : 'pill-red';
  return (
    <div className="mt-3 flex items-center gap-2 text-xs" title="Share of answer sentences grounded in the cited sources">
      <span className="micro-label">Grounding</span>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#262626]" role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Grounding ${pct} percent`}>
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum text-[#ededed]">{pct}%</span>
      <span className={`pill ${pillTone}`}><span className="dot" aria-hidden />{tone}</span>
    </div>
  );
}

function ConfidenceBanner({ confidence }: {
  confidence: { score: number; level: string; label: string; reason: string; category?: string };
}) {
  const isHigh = confidence.level === 'High' || confidence.score >= 85;
  const isMed = confidence.level === 'Medium' || (confidence.score >= 50 && confidence.score < 85);
  const pillTone = isHigh ? 'pill-green' : isMed ? 'pill-amber' : '';

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#0a0a0a] p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        {isHigh ? <CheckCircle2 size={14} className="shrink-0 text-[#00c950]" />
          : isMed ? <ShieldAlert size={14} className="shrink-0 text-[#f5a524]" />
          : <Info size={14} className="shrink-0 text-[#666]" />}
        <span className="truncate font-medium text-[#ededed]">{confidence.label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="tnum font-mono text-[11px] text-[#a1a1a1]">{confidence.score}%</span>
        <span className={`pill ${pillTone}`}><span className="dot" aria-hidden />{confidence.level}</span>
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
  const dot = isDanger ? 'bg-[#f31260]' : isWarn ? 'bg-[#f5a524]' : 'bg-[#00c950]';
  const pillTone = isDanger ? 'pill-red' : isWarn ? 'pill-amber' : 'pill-green';

  return (
    <div
      className="my-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2 text-xs transition-colors"
      aria-label={`Security Threat Level ${level}, Injection Probability ${riskPct}%`}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        <span className="text-[#a1a1a1]">Threat level</span>
        <span className="text-[#ededed]">{level}</span>
        <span className="text-[#404040]">/</span>
        <span className="text-[#a1a1a1]">Injection risk</span>
        <span className="tnum text-[#ededed]">{riskPct}%</span>
      </div>
      <div className="flex items-center gap-2">
        {flags.length > 0 ? (
          <span className="font-mono text-[11px] text-[#666]">Flags: {flags.join(', ')}</span>
        ) : (
          <span className="font-mono text-[11px] text-[#666]">Policy: clean</span>
        )}
        <span className={`pill ${pillTone}`}>
          <span className="dot" aria-hidden />
          {isDanger ? 'Blocked' : isWarn ? 'Caution' : 'Secure'}
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
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isNotAllowed ? <Lock size={16} className="text-[#f5a524]" />
            : isNotConfig ? <Database size={16} className="text-[#a1a1a1]" />
            : <Info size={16} className="text-[#666]" />}
          <h3 className="h-tight-2 text-sm font-semibold text-[#ededed]">{refusal.title}</h3>
        </div>
        <span className={`pill ${isNotAllowed ? 'pill-amber' : ''}`}>
          <span className="dot" aria-hidden />
          {isNotAllowed ? 'Access restricted' : isNotConfig ? 'Not configured' : 'Not in documents'}
        </span>
      </div>
      <SecurityThreatLine threat={threat} />
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#a1a1a1]">{refusal.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#262626] pt-3 text-xs text-[#666]">
        <span className="micro-label">Recommended action</span>
        {isNotConfig && goKnowledge && (
          <button
            onClick={goKnowledge}
            className="inline-flex items-center gap-1 font-medium text-[#ededed] underline hover:no-underline"
          >
            Upload documents in Knowledge Vault →
          </button>
        )}
        {isNotAllowed && <span className="text-[#a1a1a1]">Contact an organization administrator or professor to adjust access.</span>}
        {!isNotConfig && !isNotAllowed && <span className="text-[#a1a1a1]">Add relevant reference files in Knowledge Vault.</span>}
      </div>
      {!!layers?.length && <Trace layers={layers} />}
    </div>
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
    let embedding: number[] | undefined;
    try {
      setStatus('Embedding your question on this device…');
      markStage(0);
      [embedding] = await embedSmart([query], true);
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
      console.warn('Chat pipeline failed:', e?.message);
      // Only auto-recover with the cloud engine if we have a valid embedding.
      // Without it the server rejects the request ("Invalid input").
      if (!embedding || embedding.length !== 384) {
        finishStages();
        setMsgs((m) => [...m, {
          id: idRef.current++, role: 'assistant' as const,
          content: 'Could not create a search embedding for your question (embedding service unavailable). Please check your connection and try again.',
          error: true, refusal: null,
        }]);
        setBusy(false);
        return;
      }
      try {
        setStatus('Generating answer with NVIDIA NIM Nemotron…');
        const r = await api('/api/chat', { body: { query, embedding, keyId: 'default', model: 'nvidia/nemotron-3-super-120b-a12b' } });
        finishStages();
        const recovered: Msg = {
          id: idRef.current++, role: 'assistant', content: r.answer, layers: r.layers, sources: r.sources,
          faithfulness: r.faithfulness, blocked: r.blocked, confidence: r.confidence, refusal: r.refusal,
          threat: r.threat,
        };
        setMsgs((m) => [...m, recovered]);
        setEng({ kind: 'cloud', keyId: 'default', model: 'nvidia/nemotron-3-super-120b-a12b', label: 'NVIDIA NIM' });
      } catch (err: any) {
        setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', content: err.message || 'Request failed', error: true }]);
      }
    } finally {
      stopStageTimer(); setBusy(false); setStatus(''); setLoadPct(null);
    }
  }

  const examples = me.orgKind === 'team'
    ? ['Is student S1023 eligible for the scholarship?', 'What was my semester result?', 'Summarize the admission policy']
    : ['Summarize my uploaded documents', 'What are the key dates in my contract?', 'Find anything about payment terms'];

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h-tight truncate text-xl font-semibold text-[#ededed]">Ask {me.orgName}</h1>
          <p className="mt-0.5 text-sm text-[#a1a1a1]">Answers use only documents your role is allowed to see.</p>
        </div>
        <button
          onClick={goModels}
          aria-label={engine ? `Current model: ${engineLabel(engine)}. Open Models & keys to change.` : 'No model selected. Open Models & keys to choose one.'}
          title="Open Models & keys"
          className={`pill shrink-0 ${engine ? 'pill-green' : 'pill-amber'}`}
        >
          <span className="dot" aria-hidden />
          {engineLabel(engine)}
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto pr-1" role="log" aria-live="polite" aria-label="Conversation">
        {!msgs.length && (
          <div className="card p-8 text-center">
            <ShieldCheck size={24} className="mx-auto text-[#666]" aria-hidden />
            {!engine ? (
              <>
                <h2 className="h-tight-2 mt-3 text-base font-semibold text-[#ededed]">Choose an engine to start asking</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-[#a1a1a1]">
                  PRAMAAN never sends your documents to a model you didn&apos;t pick. Pick one:
                </p>
                <ul className="mx-auto mt-5 max-w-lg space-y-2 text-left">
                  {ENGINE_CHOICES.map((c) => (
                    <li key={c.name} className="flex items-start gap-3 rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
                      <c.icon size={16} className="mt-0.5 shrink-0 text-[#a1a1a1]" aria-hidden />
                      <div><p className="text-sm font-medium text-[#ededed]">{c.name}</p>
                      <p className="text-xs text-[#a1a1a1]">{c.desc}</p></div>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary mt-5" onClick={goModels}>Open Models &amp; keys</button>
              </>
            ) : (
              <>
                <p className="micro-label mt-3">Try one of these</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {examples.map((x) => (
                    <button
                      key={x} onClick={() => send(x)} disabled={busy}
                      className="min-h-[36px] rounded-full border border-[#262626] px-3 py-1.5 text-sm text-[#a1a1a1] transition hover:border-[#404040] hover:text-[#ededed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373] disabled:opacity-50"
                    >{x}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[95%] rounded-xl border border-[#262626] bg-[#111] px-4 py-2.5 text-sm text-[#ededed] sm:max-w-[80%]">{m.content}</div>
            ) : m.error ? (
              <div className="card p-4" role="alert">
                <div className="flex items-center gap-2">
                  <TriangleAlert size={16} className="text-[#f5a524]" aria-hidden />
                  <p className="h-tight-2 text-sm font-semibold text-[#ededed]">Something went wrong</p>
                </div>
                <p className="mt-1 text-sm text-[#a1a1a1]">{m.content}</p>
              </div>
            ) : m.refusal ? (
              <RefusalCard refusal={m.refusal} layers={m.layers} threat={m.threat} goKnowledge={goKnowledge} />
            ) : m.blocked ? (
              <div className="card p-4" role="alert">
                <div className="mb-1 flex items-center gap-2">
                  <ShieldX size={16} className="text-[#f31260]" aria-hidden />
                  <h3 className="h-tight-2 text-sm font-semibold text-[#ededed]">Blocked by the PRAMAAN security firewall</h3>
                </div>
                <SecurityThreatLine threat={m.threat} blocked={true} />
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#a1a1a1]">{m.content}</p>
                <div className="mt-3 rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
                  <p className="micro-label">What you can ask instead</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-[#a1a1a1]">
                    <li>Rephrase without instruction-style wording such as “ignore”, “reveal” or “override”.</li>
                    <li>Ask about documents your role can access — an admin can grant access to more.</li>
                    <li>Upload the relevant document in Knowledge first, then ask.</li>
                  </ul>
                </div>
                {!!m.layers?.length && <Trace layers={m.layers} />}
              </div>
            ) : (
              <div className="card p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="micro-label">PRAMAAN</span>
                  <button
                    onClick={() => copyText(m.content, m.id)}
                    aria-label={copiedId === m.id ? 'Copied' : 'Copy answer'}
                    title="Copy answer"
                    className="grid h-8 w-8 place-items-center rounded-lg text-[#666] transition hover:bg-[#111] hover:text-[#ededed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373]"
                  >
                    {copiedId === m.id ? <Check size={15} className="text-[#00c950]" /> : <Copy size={15} />}
                  </button>
                </div>
                <SecurityThreatLine threat={m.threat} />
                <AnswerBody msgId={m.id} content={m.content} sources={m.sources} hotSid={hotSid} setHotSid={setHotSid} />
                {m.confidence && <ConfidenceBanner confidence={m.confidence} />}
                {typeof m.faithfulness === 'number' && !!m.sources?.length && <Faithfulness value={m.faithfulness} />}
                {!!m.sources?.length && (
                  <div className="mt-4">
                    <p className="micro-label mb-2">
                      Evidence · {m.sources.length} source{m.sources.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-2">
                      {m.sources.map((s) => <SourceCard key={s.sid} msgId={m.id} src={s} hot={hotSid === s.sid} />)}
                    </div>
                  </div>
                )}
                {!!m.layers?.length && <Trace layers={m.layers} />}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="card p-4" aria-live="polite" aria-label="Pipeline progress">
            <ol className="flex flex-wrap items-center gap-2">
              {STAGES.map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={`pill ${stages[i] === 'done' ? 'pill-green' : stages[i] === 'active' ? 'pill-amber' : ''} ${stages[i] === 'active' ? 'animate-pulse' : ''}`}>
                    <span className="dot" aria-hidden />
                    {s}
                  </span>
                  {i < STAGES.length - 1 && <span className="text-[#404040]" aria-hidden>/</span>}
                </li>
              ))}
            </ol>
            {(status || loadPct !== null) && (
              <div className="mt-3">
                {status && <p className="text-xs text-[#a1a1a1]">{status}</p>}
                {loadPct !== null && (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#262626]" role="progressbar"
                    aria-valuenow={loadPct} aria-valuemin={0} aria-valuemax={100} aria-label="Loading local model">
                    <div className="h-full bg-white transition-[width]" style={{ width: `${loadPct}%` }} />
                  </div>
                )}
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
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#262626] bg-[#0a0a0a] text-[#a1a1a1] transition hover:border-[#404040] hover:text-[#ededed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373] active:scale-95 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
          </button>
          <textarea
            rows={2} value={q} maxLength={2000} disabled={busy || uploading}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            aria-label="Ask a question"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="max-h-48 w-full resize-y rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#ededed] outline-none transition placeholder:text-[#666] focus:border-[#737373] disabled:opacity-50"
          />
          <button
            onClick={() => send()} disabled={busy || uploading || !q.trim()}
            aria-label="Send question"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black transition hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373] active:scale-95 disabled:opacity-40"
          >
            <Send size={16} aria-hidden />
          </button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-[#666]">
          <kbd className="rounded border border-[#262626] bg-[#0a0a0a] px-1">Ctrl/⌘ K</kbd> to focus ·
          answers cite only documents your role can access · all queries audited
        </p>
      </div>
    </div>
  );
}
