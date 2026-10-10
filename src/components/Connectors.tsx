'use client';
import { useState } from 'react';
import { Database, FolderGit2, Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button, Card, Input, Label, Textarea, Progress, SectionTitle } from './ui';
import { api } from '@/lib/client/api';
import { AccessPicker } from './Knowledge';
import { ingest, type Access } from '@/lib/client/ingest';
import { driveToken, driveList, driveDownload, type DriveFile } from '@/lib/client/drive';
import { extractFile } from '@/lib/client/extract';

export default function Connectors({ me }: { me: any }) {
  // PostgreSQL state
  const [connStr, setConnStr] = useState('');
  const [sqlQuery, setSqlQuery] = useState('SELECT id, name, details, student_id FROM records LIMIT 100;');
  const [subjectCol, setSubjectCol] = useState('student_id');
  const [docTitle, setDocTitle] = useState('PostgreSQL Database Export');
  const [access, setAccess] = useState<Access>({ visibility: 'private', allowedRoles: [] });
  const [dbProgress, setDbProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [dbErr, setDbErr] = useState('');

  // Google Drive state
  const [clientId, setClientId] = useState(me?.googleClientId || '');
  const [driveTokenStr, setDriveTokenStr] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveProgress, setDriveProgress] = useState<{ pct: number; msg: string } | null>(null);

  async function runPostgresImport(e: React.FormEvent) {
    e.preventDefault();
    setDbErr('');
    setDbProgress({ pct: 5, msg: 'Querying database securely (read-only)...' });
    try {
      const res = await api<{ rows: { text: string; subject: string | null }[] }>(
        '/api/connectors/postgres',
        {
          body: {
            connectionString: connStr.trim(),
            query: sqlQuery.trim(),
            subjectColumn: subjectCol.trim() || null,
          },
        }
      );

      if (!res.rows?.length) {
        throw new Error('Query returned 0 rows');
      }

      setDbProgress({ pct: 25, msg: `Fetched ${res.rows.length} rows. Chunking & embedding on device...` });

      const r = await ingest(
        {
          title: docTitle.trim() || 'PostgreSQL Import',
          source: 'postgres',
          mime: 'application/x-database-rows',
          ...access,
        },
        { rows: res.rows },
        (pct) => setDbProgress({ pct, msg: `Embedding and syncing chunks (${pct}%)...` })
      );

      setDbProgress({
        pct: 100,
        msg: `Done! Imported ${r.chunks} chunks (${r.quarantined} quarantined).`,
      });
    } catch (err: any) {
      setDbErr(err.message);
      setDbProgress(null);
    }
  }

  async function connectDrive() {
    setDriveBusy(true);
    try {
      const token = await driveToken(clientId.trim());
      setDriveTokenStr(token);
      const list = await driveList(token, driveSearch.trim());
      setDriveFiles(list);
    } catch (err: any) {
      alert(`Google Drive error: ${err.message}`);
    } finally {
      setDriveBusy(false);
    }
  }

  async function importDriveFile(file: DriveFile) {
    setDriveProgress({ pct: 10, msg: `Downloading ${file.name}...` });
    try {
      const downloaded = await driveDownload(driveTokenStr, file);
      setDriveProgress({ pct: 30, msg: `Extracting text from ${file.name}...` });
      const extracted = await extractFile(downloaded);
      setDriveProgress({ pct: 50, msg: `Embedding chunks locally...` });

      const r = await ingest(
        {
          title: file.name,
          source: 'google-drive',
          mime: file.mimeType || 'text/plain',
          ...access,
        },
        extracted,
        (pct) => setDriveProgress({ pct, msg: `Syncing chunks (${pct}%)...` })
      );

      setDriveProgress({
        pct: 100,
        msg: `Done! Imported ${r.chunks} chunks from ${file.name}`,
      });
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
      setDriveProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Live Data Connectors"
        desc="Import structured records and documents directly into the permission-aware vector index."
      />

      {/* PostgreSQL Connector */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-medium text-white">
          <Database size={18} className="text-indigo-400" />
          PostgreSQL Database Connector
        </div>
        <p className="text-xs text-zinc-400">
          Executes a read-only query server-side, then embeds records directly on your local device for zero data exposure.
        </p>

        <form onSubmit={runPostgresImport} className="space-y-3">
          <div>
            <Label>Connection String</Label>
            <Input
              type="password"
              placeholder="postgres://user:password@host:5432/dbname?sslmode=require"
              required
              value={connStr}
              onChange={(e) => setConnStr(e.target.value)}
            />
          </div>

          <div>
            <Label>SQL Query (Single Read-Only SELECT)</Label>
            <Textarea
              rows={3}
              required
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Row-Level Isolation Column (Optional)</Label>
              <Input
                placeholder="e.g. student_id, emp_id"
                value={subjectCol}
                onChange={(e) => setSubjectCol(e.target.value)}
              />
            </div>
            <div>
              <Label>Saved Document Title</Label>
              <Input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
              />
            </div>
          </div>

          <AccessPicker me={me} value={access} onChange={setAccess} />

          {dbErr && (
            <div className="flex items-center gap-2 text-xs text-red-400">
              <AlertCircle size={14} />
              {dbErr}
            </div>
          )}

          {dbProgress && (
            <Progress value={dbProgress.pct} label={dbProgress.msg} />
          )}

          <Button type="submit">
            <Play size={14} /> Run Query & Ingest Vectors
          </Button>
        </form>
      </Card>

      {/* Google Drive Connector */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-medium text-white">
          <FolderGit2 size={18} className="text-indigo-400" />
          Google Drive Connector
        </div>
        <p className="text-xs text-zinc-400">
          Connect your Google Workspace. Files are retrieved securely using browser client tokens and embedded in your browser.
        </p>

        {!driveTokenStr ? (
          <div className="space-y-3">
            <div>
              <Label>Google OAuth Client ID</Label>
              <Input
                placeholder="YOUR_CLIENT_ID.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <Button onClick={connectDrive} disabled={driveBusy || !clientId.trim()}>
              {driveBusy ? 'Connecting...' : 'Authorize Google Drive'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 size={14} /> Authorized with Google Drive
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Search Drive files..."
                value={driveSearch}
                onChange={(e) => setDriveSearch(e.target.value)}
              />
              <Button
                variant="ghost"
                onClick={async () => {
                  const list = await driveList(driveTokenStr, driveSearch.trim());
                  setDriveFiles(list);
                }}
              >
                Search
              </Button>
            </div>

            {driveProgress && <Progress value={driveProgress.pct} label={driveProgress.msg} />}

            <div className="max-h-60 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/5 bg-zinc-950/50 p-2">
              {!driveFiles.length ? (
                <div className="p-3 text-xs text-zinc-500">No documents found.</div>
              ) : (
                driveFiles.map((f) => (
                  <div key={f.id} className="flex items-center justify-between p-2 text-sm">
                    <div className="truncate">
                      <div className="truncate font-medium text-white">{f.name}</div>
                      <div className="text-xs text-zinc-500">{f.mimeType}</div>
                    </div>
                    <Button variant="ghost" onClick={() => importDriveFile(f)}>
                      Import
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
