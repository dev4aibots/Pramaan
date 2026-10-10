/** Google Drive (read-only) via Google Identity Services token flow — files are downloaded & embedded in the browser. */
declare global { interface Window { google?: any } }

function loadGis(): Promise<void> {
  return new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Failed to load Google sign-in'));
    document.head.appendChild(s);
  });
}

export async function driveToken(clientId: string): Promise<string> {
  await loadGis();
  return new Promise((res, rej) => {
    const c = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (r: any) => (r.access_token ? res(r.access_token) : rej(new Error(r.error || 'Authorization failed'))),
    });
    c.requestAccessToken();
  });
}

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string };

export async function driveList(token: string, search = ''): Promise<DriveFile[]> {
  const q = [`trashed = false`, `mimeType != 'application/vnd.google-apps.folder'`, search ? `name contains '${search.replace(/'/g, "\\'")}'` : ''].filter(Boolean).join(' and ');
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?pageSize=100&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Drive list failed');
  return (await r.json()).files ?? [];
}

export async function driveDownload(token: string, f: DriveFile): Promise<File> {
  const h = { Authorization: `Bearer ${token}` };
  let url = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
  let name = f.name;
  if (f.mimeType === 'application/vnd.google-apps.document') { url = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`; name += '.txt'; }
  else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') { url = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/csv`; name += '.csv'; }
  else if (f.mimeType === 'application/vnd.google-apps.presentation') { url = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`; name += '.txt'; }
  const r = await fetch(url, { headers: h });
  if (!r.ok) throw new Error(`Download failed: ${f.name}`);
  return new File([await r.blob()], name);
}
