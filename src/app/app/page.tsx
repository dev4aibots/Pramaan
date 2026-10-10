'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, FolderLock, Plug, Users, Cpu, ScrollText, LogOut } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Select, Badge } from '@/components/ui';
import Chat from '@/components/Chat';
import Knowledge from '@/components/Knowledge';
import Connectors from '@/components/Connectors';
import Team from '@/components/Team';
import Models from '@/components/Models';
import Audit from '@/components/Audit';

const TABS = [
  { id: 'chat', name: 'Ask', icon: MessageSquare },
  { id: 'knowledge', name: 'Knowledge', icon: FolderLock },
  { id: 'connectors', name: 'Connectors', icon: Plug },
  { id: 'team', name: 'Team & roles', icon: Users },
  { id: 'models', name: 'Models & keys', icon: Cpu },
  { id: 'audit', name: 'Audit log', icon: ScrollText },
] as const;

export default function AppPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('chat');

  const load = useCallback(async () => {
    try { setMe(await api('/api/me')); } catch { router.push('/login'); }
  }, [router]);
  useEffect(() => { load(); }, [load]);

  async function switchOrg(orgId: string) { await api('/api/orgs', { method: 'PUT', body: { orgId } }); await load(); }
  async function logout() { await api('/api/auth/logout', { body: {} }); router.push('/login'); }

  if (!me) return <div className="grid min-h-screen place-items-center text-zinc-500">Loading secure workspace…</div>;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-zinc-950 p-4">
        <div className="mb-6 flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600">प्र</span> PRAMAAN</div>
        <Select value={me.orgId} onChange={(e) => switchOrg(e.target.value)}>
          {me.orgs.map((o: any) => <option key={o.id} value={o.id}>{o.kind === 'personal' ? '🔒 ' : '🏛 '}{o.name}</option>)}
        </Select>
        <div className="mt-2 flex flex-wrap gap-1"><Badge tone="indigo">{me.role}</Badge>{me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}</div>
        <nav className="mt-6 space-y-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm ${tab === t.id ? 'bg-indigo-600/20 text-indigo-200' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
              <t.icon size={16} /> {t.name}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-4 text-xs text-zinc-500">
          <div className="truncate">{me.email}</div>
          <button onClick={logout} className="mt-2 flex items-center gap-2 text-zinc-400 hover:text-white"><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <main className="grid-bg flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {tab === 'chat' && <Chat me={me} goModels={() => setTab('models')} />}
          {tab === 'knowledge' && <Knowledge me={me} />}
          {tab === 'connectors' && <Connectors me={me} />}
          {tab === 'team' && <Team me={me} reload={load} />}
          {tab === 'models' && <Models me={me} />}
          {tab === 'audit' && <Audit />}
        </div>
      </main>
    </div>
  );
}
