'use client';
import { useCallback, useEffect, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { Button, Card, Badge, Progress, Select, Input, Label, SectionTitle } from './ui';
import { api } from '@/lib/client/api';
import { extractFile } from '@/lib/client/extract';
import { ingest, type Access } from '@/lib/client/ingest';

const ROLES = ['admin', 'manager', 'member', 'viewer'];

export function AccessPicker({ me, value, onChange }: { me: any; value: Access; onChange: (a: Access) => void }) {
  const canShare = me.orgKind === 'team' && ['owner', 'admin', 'manager'].includes(me.role);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Who can retrieve this</Label>
        <Select value={value.visibility} onChange={(e) => onChange({ ...value, visibility: e.target.value as any })} disabled={!canShare}>
          <option value="private">Only me (private)</option>
          {canShare && <option value="org">Everyone in {me.orgName}</option>}
          {canShare && <option value="roles">Specific roles only</option>}
        </Select>
      </div>
      {value.visibility === 'roles' && (
        <div>
          <Label>Allowed roles</Label>
          <div className="flex flex-wrap gap-2 pt-1">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={value.allowedRoles.includes(r)}
                  onChange={(e) => onChange({ ...value, allowedRoles: e.target.checked ? [...value.allowedRoles, r] : value.allowedRoles.filter((x) => x !== r) })} /> {r}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Knowledge({ me }: { me: any }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [access, setAccess] = useState<Access>({ visibility: 'private', allowedRoles: [] });
  const [subjectCol, setSubjectCol] = useState('');
  const [queue, setQueue] = useState<{ name: string; p: number; msg: string }[]>([]);
  const [drag, setDrag] = useState(false);

  const load = useCallback(async () => setDocs((await api('/api/documents')).documents), []);
  useEffect(() => { load(); }, [load, me.orgId]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    setQueue(list.map((f) => ({ name: f.name, p: 0, msg: 'queued' })));
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const upd = (p: number, msg: string) => setQueue((q) => q.map((x, j) => (j === i ? { ...x, p, msg } : x)));
      try {
        upd(2, 'extracting text locally…');
        const data = await extractFile(f, subjectCol.trim() || undefined);
        upd(5, 'chunking & embedding on device…');
        const r = await ingest({ title: f.name, source: 'upload', mime: f.type || 'text/plain', ...access }, data, (p) => upd(p, 'embedding & storing…'));
        upd(100, `✓ ${r.chunks} chunks${r.quarantined ? ` · ⚠ ${r.quarantined} quarantined` : ''}`);
      } catch (e: any) { upd(100, `✗ ${e.message}`); }
    }
    load();
  }

  async function del(id: string) { if (confirm('Delete document and all its embeddings permanently?')) { await api(`/api/documents?id=${id}`, { method: 'DELETE' }); load(); } }

  return (
    <div className="space-y-6">
      <SectionTitle title="Knowledge vault" desc="Files are parsed and embedded in your browser. Only text chunks and vectors are stored, with access rules attached." />
      <Card className="space-y-4">
        <AccessPicker me={me} value={access} onChange={setAccess} />
        <div>
          <Label>Row-level security column (spreadsheets / JSON, optional)</Label>
          <Input placeholder="e.g. student_id — each row becomes visible only to the member with that ID" value={subjectCol} onChange={(e) => setSubjectCol(e.target.value)} />
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${drag ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/10 hover:border-white/20'}`}>
          <Upload className="text-indigo-400" />
          <p className="mt-2 text-sm">Drop files or click to upload</p>
          <p className="text-xs text-zinc-500">PDF, DOCX, XLSX, CSV, JSON, HTML, TXT, MD and code files</p>
          <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </label>
        {queue.map((x) => <Progress key={x.name} value={x.p} label={`${x.name} — ${x.msg}`} />)}
      </Card>
      <Card>
        <div className="mb-3 text-sm font-medium">{docs.length} documents you can access</div>
        <div className="divide-y divide-white/5">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.title}</div>
                <div className="text-xs text-zinc-500">{d.owner_email} · {new Date(d.created_at).toLocaleString()} · {d.source}</div>
              </div>
              <Badge tone={d.visibility === 'private' ? 'zinc' : d.visibility === 'org' ? 'green' : 'indigo'}>{d.visibility === 'roles' ? `roles: ${d.allowed_roles.join(', ')}` : d.visibility}</Badge>
              {d.mine && <Button variant="ghost" onClick={() => del(d.id)}><Trash2 size={14} /></Button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
