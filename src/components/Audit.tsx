'use client';
import { useCallback, useEffect, useState } from 'react';
import { ScrollText, ShieldCheck, RefreshCw, Key, Hash } from 'lucide-react';
import { Button, Card, Badge, SectionTitle } from './ui';
import { api } from '@/lib/client/api';

export default function Audit() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/api/audit');
      setEntries(res.entries || []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const actionTone = (act: string): 'indigo' | 'green' | 'amber' | 'red' | 'zinc' => {
    if (act.includes('quarantine') || act.includes('block')) return 'red';
    if (act.includes('create') || act.includes('signup')) return 'green';
    if (act.includes('chat') || act.includes('retrieve')) return 'indigo';
    if (act.includes('warn') || act.includes('update')) return 'amber';
    return 'zinc';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle
          title="Cryptographic Audit Trail"
          desc="Immutable, hash-chained log of all security evaluations, retrievals, and data actions."
        />
        <Button variant="ghost" onClick={loadAudit} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh Log
        </Button>
      </div>

      <Card className="flex items-center gap-3 border-emerald-500/20 bg-emerald-950/10 p-4">
        <ShieldCheck className="text-emerald-400" size={24} />
        <div>
          <div className="text-sm font-semibold text-emerald-300">Tamper-Evident SHA-256 Chain</div>
          <div className="text-xs text-zinc-400">
            Each entry seals the previous record's cryptographic hash, guaranteeing that query logs and security decisions cannot be altered retroactively.
          </div>
        </div>
      </Card>

      <Card>
        {!entries.length ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            {loading ? 'Fetching audit records...' : 'No audit entries recorded yet.'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map((e) => (
              <div key={e.uid} className="py-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                    <span className="font-medium text-zinc-300">{e.email || 'System'}</span>
                  </div>
                  <span className="text-zinc-500">{new Date(e.created_at).toLocaleString()}</span>
                </div>

                {e.detail && Object.keys(e.detail).length > 0 && (
                  <pre className="max-h-28 overflow-y-auto rounded-lg border border-white/5 bg-zinc-950/80 p-2 text-xs text-zinc-400">
                    {JSON.stringify(e.detail, null, 2)}
                  </pre>
                )}

                <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono truncate">
                  <Hash size={11} className="shrink-0 text-zinc-600" />
                  <span className="truncate">Hash: {e.hash}</span>
                  <span className="shrink-0 text-zinc-600">· UID: {e.uid.slice(0, 8)}...</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
