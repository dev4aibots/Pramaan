import Link from 'next/link';

const problems = [
  ['Data leaks across users', 'Permission filters run inside the database query, so a user’s unauthorized data never reaches the model.'],
  ['Hallucinated answers', 'Every sentence is cited and checked against the sources it cites. You see a grounding score on every answer.'],
  ['Prompt injection & poisoned files', 'An injection firewall checks every query, and poisoned chunks are quarantined when uploaded and dropped again at answer time.'],
  ['Privacy & cost', 'Embeddings are computed in your browser. Use your own key, or run models fully locally with no per-token cost.'],
  ['Complex setup', 'One Vercel deploy and one Postgres database. Download browser models with one click, or connect Ollama or LM Studio.'],
  ['Organization-scale questions', 'A university can import student results with row-level security, so each student sees only their own record.'],
];
const layers = ['Identity & tenant isolation', 'Prompt-injection firewall', 'Permission-aware retrieval (RBAC + row-level)', 'Context sanitization & PII shield', 'Output verification & audit chain'];

export default function Landing() {
  return (
    <main className="grid-bg min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600">प्र</span> PRAMAAN</div>
        <div className="flex gap-3">
          <Link href="/login" className="rounded-xl px-4 py-2 text-sm text-zinc-300 hover:text-white">Sign in</Link>
          <Link href="/login?mode=signup" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">Get started</Link>
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 text-center">
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300">“Evidence must be earned before it is used.”</span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Ask your documents anything. <span className="text-indigo-400">Only see what you’re allowed to.</span></h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">Private, verified, role-based RAG for individuals and organizations. Bring your own key, or run models in your browser, Ollama, or LM Studio.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login?mode=signup" className="rounded-xl bg-indigo-600 px-6 py-3 font-medium hover:bg-indigo-500">Create free vault</Link>
          <a href="https://github.com/dev4aibots/pramaan" className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-medium hover:bg-white/10">GitHub</a>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-6 text-center text-2xl font-semibold">5-layer secure RAG</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          {layers.map((l, i) => (
            <div key={l} className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
              <div className="text-xs text-indigo-400">Layer {i + 1}</div>
              <div className="mt-1 text-sm font-medium">{l}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {problems.map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
            <div className="font-medium">{t}</div>
            <p className="mt-2 text-sm text-zinc-400">{d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
