'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users, UserPlus, Trash2, Copy, Check, Building, ShieldAlert,
  Eye, PlusCircle, LogIn, RefreshCw, KeyRound, X, Info, Repeat,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { type Role } from '@/lib/auth';

const ROLES: Role[] = ['owner', 'admin', 'manager', 'member', 'viewer'];

/** Privilege explanations shown next to the role editor and invite form. */
const ROLE_PRIVILEGES: Record<Role, string> = {
  owner: 'Full control. Can manage admins, all members, and invites. There is exactly one owner and it cannot be removed or demoted.',
  admin: 'Can manage members (except changing other admins), remove members, create invites, and manage shared keys.',
  manager: 'Can upload and share documents with the team, and invite members and viewers.',
  member: 'Can upload documents, chat with authorized documents, and join workspaces with an invite code.',
  viewer: 'Read-only. Can chat with documents they are authorized to see. Cannot upload or manage anything.',
};

const ROLE_PILL: Record<Role, string> = {
  owner: 'pill-blue', admin: 'pill-amber', manager: 'pill-green', member: '', viewer: '',
};

type Org = { id: string; name: string; kind: 'personal' | 'team'; role: Role };
type Member = { id: string; email: string; name: string; role: Role; subject_ref: string | null };

function RolePill({ role, children }: { role: Role; children?: React.ReactNode }) {
  return (
    <span className={`pill ${ROLE_PILL[role]}`.trim()}>
      <span className="dot" />
      {children ?? role}
    </span>
  );
}

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <div className="micro-label">{title}</div>
      {desc && <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{desc}</p>}
    </div>
  );
}

function WhyNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed"
      style={{ borderColor: 'rgba(245,165,36,.35)', background: 'var(--surface)', color: 'var(--muted)' }}
    >
      <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
      <p className="[&_strong]:text-[var(--text)] [&_strong]:font-medium">{children}</p>
    </div>
  );
}

/** Small accessible modal with focus restore + Escape to close. */
function ConfirmModal({
  title, body, confirmLabel, onConfirm, onClose, busy,
}: {
  title: string; body: React.ReactNode; confirmLabel: string;
  onConfirm: () => void; onClose: () => void; busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prevFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
        <div className="mt-2 text-[13px] leading-relaxed text-[var(--muted)] [&_strong]:text-[var(--text)] [&_strong]:font-medium">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <RefreshCw size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Team({ me, reload }: { me: any; reload: () => Promise<void> }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersErr, setMembersErr] = useState('');

  // Invite creation
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'member' | 'viewer'>('member');
  const [inviteSubject, setInviteSubject] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteErr, setInviteErr] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);

  // Org create / join / switch
  const [orgName, setOrgName] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinErr, setJoinErr] = useState('');
  const [joining, setJoining] = useState(false);
  const [switchingTo, setSwitchingTo] = useState('');
  const [switchErr, setSwitchErr] = useState('');

  // Remove member modal
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const isTeam = me?.orgKind === 'team';
  const orgs: Org[] = me?.orgs ?? [];

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersErr('');
    try {
      const res = await api('/api/members');
      setMembers(res.members || []);
    } catch (err: any) {
      setMembers([]);
      setMembersErr(err.message || 'Could not load members');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers, me?.orgId]);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr('');
    setCreatingOrg(true);
    try {
      await api('/api/orgs', { body: { name: orgName.trim() } });
      setOrgName('');
      await reload();
      await loadMembers();
    } catch (err: any) {
      setCreateErr(err.message);
    } finally {
      setCreatingOrg(false);
    }
  }

  async function joinOrg(e: React.FormEvent) {
    e.preventDefault();
    setJoinErr('');
    setJoining(true);
    try {
      await api('/api/orgs/join', { body: { code: joinCode.trim() } });
      setJoinCode('');
      await reload();
      await loadMembers();
    } catch (err: any) {
      setJoinErr(err.message);
    } finally {
      setJoining(false);
    }
  }

  async function switchOrg(orgId: string) {
    if (orgId === me.orgId || switchingTo) return;
    setSwitchingTo(orgId);
    setSwitchErr('');
    try {
      await api('/api/orgs', { method: 'PUT', body: { orgId } });
      await reload();
      await loadMembers();
    } catch (err: any) {
      setSwitchErr(err.message);
    } finally {
      setSwitchingTo('');
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr('');
    setCreatingInvite(true);
    try {
      const r = await api('/api/invites', {
        body: {
          role: inviteRole,
          subjectRef: inviteSubject.trim() || null,
          maxUses: Math.min(1000, Math.max(1, Number(inviteMaxUses) || 1)),
        },
      });
      setGeneratedCode(r.code);
    } catch (err: any) {
      setInviteErr(err.message);
    } finally {
      setCreatingInvite(false);
    }
  }

  async function updateMember(userId: string, role: string, subjectRef: string | null) {
    try {
      await api('/api/members', { method: 'PATCH', body: { userId, role, subjectRef } });
      loadMembers();
    } catch (err: any) {
      alert(err.message);
      loadMembers();
    }
  }

  async function confirmRemoveMember() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api(`/api/members?userId=${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      loadMembers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
    } catch {
      // Clipboard API can fail on non-secure contexts; fall back to a prompt-less selection
      const ta = document.createElement('textarea');
      ta.value = generatedCode;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* last resort: user selects the code */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const editable = (m: Member) => isAdmin && isTeam && m.role !== 'owner' && m.id !== me.userId;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Team & Access Control"
        desc="Manage workspace members, assign RBAC roles, and bind subject IDs for row-level isolation."
      />

      {/* Current workspace status */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Building size={18} className="text-[var(--muted)]" />
              <h3 className="text-[15px] font-semibold text-[var(--text)]">{me.orgName}</h3>
              <span className="pill"><span className="dot" />{me.orgKind}</span>
              <RolePill role={me.role as Role} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1"><Eye size={12} /> You see {isAdmin ? 'all members and can manage them' : 'your own membership (read-only)'}</span>
              {me.subjectRef && (
                <span>· Row identifier <code className="font-mono text-[var(--text)]">{me.subjectRef}</code></span>
              )}
            </div>
          </div>
        </div>
        {!isTeam && (
          <div className="mt-4">
            <WhyNote>
              You are in your <strong>personal vault</strong>. Team features (member list, invites, role management) are hidden —
              create a team workspace below to invite members.
            </WhyNote>
          </div>
        )}
      </div>

      {/* Workspace switcher */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Repeat size={15} className="text-[var(--muted)]" />
          <span className="micro-label">Your Workspaces <span className="tnum">({orgs.length})</span></span>
        </div>
        {switchErr && <p role="alert" className="mb-3 text-[13px]" style={{ color: 'var(--red)' }}>{switchErr}</p>}
        {orgs.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No workspaces found. Create one below to get started.</p>
        ) : (
          <div>
            {orgs.map((o) => {
              const active = o.id === me.orgId;
              return (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-1 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
                    <span className="truncate font-medium text-[var(--text)]">{o.name}</span>
                    <span className="pill"><span className="dot" />{o.kind}</span>
                    <RolePill role={o.role} />
                    {active && <span className="pill pill-green"><span className="dot" />Current</span>}
                  </div>
                  {!active && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => switchOrg(o.id)}
                      disabled={!!switchingTo}
                    >
                      {switchingTo === o.id ? <RefreshCw size={13} className="animate-spin" /> : 'Switch'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isTeam ? (
        <>
          {/* Member list */}
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={15} className="text-[var(--muted)]" />
                <span className="micro-label">Members <span className="tnum">({members.length})</span></span>
              </div>
              {loadingMembers && (
                <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
                  <RefreshCw size={12} className="animate-spin" /> Loading…
                </span>
              )}
            </div>

            {membersErr && (
              <div
                className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-[13px]"
                style={{ borderColor: 'rgba(243,18,96,.35)', background: 'var(--surface)', color: 'var(--red)' }}
              >
                <span role="alert">{membersErr}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadMembers}>Retry</button>
              </div>
            )}

            {!isAdmin && (
              <div className="mb-4">
                <WhyNote>
                  Your role is <strong>{me.role}</strong>. Member management is read-only for you — only
                  <strong> admins and the owner</strong> can change roles, edit row identifiers, or remove members.
                  Ask an admin if you need a change.
                </WhyNote>
              </div>
            )}

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="micro-label py-2 pr-3 font-normal">Member</th>
                    <th scope="col" className="micro-label py-2 pr-3 font-normal">Role</th>
                    <th scope="col" className="micro-label py-2 pr-3 font-normal">Row identifier</th>
                    <th scope="col" className="micro-label py-2 font-normal"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--text)]">
                          {m.name || m.email}
                          {m.id === me.userId && <span className="pill"><span className="dot" />You</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--muted)]">{m.email}</div>
                      </td>
                      <td className="py-3 pr-3">
                        {editable(m) ? (
                          <div>
                            <select
                              value={m.role}
                              aria-label={`Role for ${m.email}`}
                              onChange={(e) => updateMember(m.id, e.target.value, m.subject_ref)}
                              className="input"
                              style={{ height: 32, fontSize: 12, width: 128 }}
                            >
                              {ROLES.filter((r) => r !== 'owner').map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <p className="mt-1 max-w-xs text-[11px] leading-snug text-[var(--muted)]">
                              {ROLE_PRIVILEGES[m.role]}
                            </p>
                          </div>
                        ) : (
                          <span title={ROLE_PRIVILEGES[m.role]}><RolePill role={m.role} /></span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {editable(m) ? (
                          <input
                            key={`${m.id}-${m.subject_ref}`}
                            placeholder="e.g. S1023"
                            defaultValue={m.subject_ref || ''}
                            aria-label={`Row identifier for ${m.email}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null;
                              if (v !== m.subject_ref) updateMember(m.id, m.role, v);
                            }}
                            className="input"
                            style={{ height: 32, fontSize: 12, width: 128 }}
                          />
                        ) : m.subject_ref ? (
                          <code className="font-mono text-xs text-[var(--text)]">{m.subject_ref}</code>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--faint)' }}>—</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {editable(m) ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--red)', borderColor: 'rgba(243,18,96,.4)' }}
                            onClick={() => setRemoving(m)}
                            aria-label={`Remove ${m.email}`}
                            title="Remove member"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : m.role === 'owner' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]" title="The workspace owner cannot be removed or demoted">
                            <ShieldAlert size={12} /> protected
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {members.length === 0 && !loadingMembers && !membersErr && (
                <p className="py-8 text-center text-[13px] text-[var(--muted)]">No members yet. Create an invite below to bring people in.</p>
              )}
            </div>

            {/* Mobile cards */}
            <div className="md:hidden">
              {members.map((m) => (
                <div key={m.id} className="border-b border-[var(--border)] py-4 first:pt-0 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--text)]">
                        <span className="truncate">{m.name || m.email}</span>
                        {m.id === me.userId && <span className="pill"><span className="dot" />You</span>}
                      </div>
                      <div className="truncate text-xs text-[var(--muted)]">{m.email}</div>
                    </div>
                    <RolePill role={m.role} />
                  </div>
                  {m.subject_ref && (
                    <div className="mt-2 text-xs text-[var(--muted)]">
                      Row ID: <code className="font-mono text-[var(--text)]">{m.subject_ref}</code>
                    </div>
                  )}
                  {editable(m) && (
                    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                      <div>
                        <div className="micro-label mb-1.5">Role</div>
                        <select
                          value={m.role}
                          aria-label={`Role for ${m.email}`}
                          onChange={(e) => updateMember(m.id, e.target.value, m.subject_ref)}
                          className="input"
                        >
                          {ROLES.filter((r) => r !== 'owner').map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{ROLE_PRIVILEGES[m.role]}</p>
                      </div>
                      <div>
                        <div className="micro-label mb-1.5">Row identifier</div>
                        <input
                          key={`${m.id}-mobile-${m.subject_ref}`}
                          placeholder="e.g. S1023 (Roll / Emp ID)"
                          defaultValue={m.subject_ref || ''}
                          aria-label={`Row identifier for ${m.email}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== m.subject_ref) updateMember(m.id, m.role, v);
                          }}
                          className="input"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm w-full"
                        style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                        onClick={() => setRemoving(m)}
                      >
                        <Trash2 size={13} /> Remove member
                      </button>
                    </div>
                  )}
                  {m.role === 'owner' && isAdmin && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--muted)]">
                      <ShieldAlert size={12} /> The owner is protected and cannot be removed or demoted.
                    </p>
                  )}
                </div>
              ))}
              {members.length === 0 && !loadingMembers && !membersErr && (
                <p className="py-8 text-center text-[13px] text-[var(--muted)]">No members yet. Create an invite below to bring people in.</p>
              )}
            </div>
          </div>

          {/* Invite generator */}
          {isAdmin ? (
            <div className="card p-5">
              <div className="mb-1 flex items-center gap-2">
                <UserPlus size={15} className="text-[var(--muted)]" />
                <span className="micro-label">Generate Workspace Invite</span>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
                Share the code with the person you want to invite. They join via the “Join Workspace” form below.
              </p>

              <form onSubmit={createInvite} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <div className="micro-label mb-1.5">Role to grant</div>
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)} className="input">
                      <option value="viewer">Viewer — read-only</option>
                      <option value="member">Member — upload & chat</option>
                      <option value="manager">Manager — share docs, invite</option>
                      {me.role === 'owner' && <option value="admin">Admin — manage members</option>}
                    </select>
                    <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{ROLE_PRIVILEGES[inviteRole]}</p>
                  </div>
                  <div>
                    <div className="micro-label mb-1.5">Row security ID (optional)</div>
                    <input
                      placeholder="e.g. S1023 (Roll / Emp ID)"
                      value={inviteSubject}
                      onChange={(e) => setInviteSubject(e.target.value)}
                      className="input"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
                      Binds the new member to their own rows — they only see chunks tagged with this ID.
                    </p>
                  </div>
                  <div>
                    <div className="micro-label mb-1.5">Max uses</div>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={inviteMaxUses}
                      onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                      className="input tnum"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
                      How many people can join with this code before it is exhausted.
                    </p>
                  </div>
                </div>

                {inviteErr && <p role="alert" className="text-[13px]" style={{ color: 'var(--red)' }}>{inviteErr}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" className="btn btn-primary" disabled={creatingInvite}>
                    <KeyRound size={15} />
                    {creatingInvite ? 'Creating…' : 'Create Invite Code'}
                  </button>
                  <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <Info size={12} /> Invite codes expire 7 days after creation.
                  </span>
                </div>
              </form>

              {generatedCode && (
                <div
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  style={{ borderColor: 'var(--border)', background: '#111' }}
                >
                  <div className="min-w-0">
                    <div className="micro-label">Share this code with the invitee:</div>
                    <div className="mt-1 select-all font-mono text-sm font-medium text-[var(--text)]">{generatedCode}</div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copyCode}>
                    {copied ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <UserPlus size={15} className="text-[var(--muted)]" />
                <span className="micro-label">Invite Members</span>
              </div>
              <WhyNote>
                Invites are available to <strong>admins and the owner</strong>. Your role is <strong>{me.role}</strong> —
                ask an admin for an invite code if you need to bring someone in.
              </WhyNote>
            </div>
          )}
        </>
      ) : (
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users size={15} className="text-[var(--muted)]" />
            <span className="micro-label">Members & Invites</span>
          </div>
          <WhyNote>
            This is your <strong>personal vault</strong> — it holds only your own documents and has no members.
            To invite people, assign roles, or use row-level security, create a <strong>team workspace</strong> below.
          </WhyNote>
        </div>
      )}

      {/* Create or join workspace */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <PlusCircle size={15} className="text-[var(--muted)]" />
            <span className="micro-label">Create Team Workspace</span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
            Create an isolated organization workspace with team RBAC and row-level sharing. You become its owner.
          </p>
          <form onSubmit={createOrg} className="space-y-3">
            <input
              placeholder="Workspace name (e.g. Acme Legal)"
              required
              minLength={2}
              maxLength={80}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              aria-label="New workspace name"
              className="input"
            />
            {createErr && <p role="alert" className="text-xs" style={{ color: 'var(--red)' }}>{createErr}</p>}
            <button type="submit" className="btn btn-primary" disabled={creatingOrg || !orgName.trim()}>
              {creatingOrg && <RefreshCw size={14} className="animate-spin" />}
              {creatingOrg ? 'Creating…' : 'Create Team Workspace'}
            </button>
          </form>
        </div>

        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <LogIn size={15} className="text-[var(--muted)]" />
            <span className="micro-label">Join Workspace with Code</span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
            Enter an invite code (PRM-XXXX) from a workspace administrator. You take the role and row ID the code was issued for.
          </p>
          <form onSubmit={joinOrg} className="space-y-3">
            <input
              placeholder="e.g. PRM-a1b2c3d4"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              aria-label="Invite code"
              className="input font-mono"
            />
            {joinErr && <p role="alert" className="text-xs" style={{ color: 'var(--red)' }}>{joinErr}</p>}
            <button type="submit" className="btn btn-secondary" disabled={joining || !joinCode.trim()}>
              {joining && <RefreshCw size={14} className="animate-spin" />}
              {joining ? 'Joining…' : 'Join Workspace'}
            </button>
          </form>
        </div>
      </div>

      {/* Remove member confirmation */}
      {removing && (
        <ConfirmModal
          title="Remove member?"
          body={
            <p>
              Remove <strong>{removing.name || removing.email}</strong> ({removing.email}) from
              the workspace <strong>{me.orgName}</strong>? They lose access immediately and must
              be re-invited to rejoin. The owner can never be removed — this safeguard is enforced by the server too.
            </p>
          }
          confirmLabel="Remove member"
          busy={removeBusy}
          onConfirm={confirmRemoveMember}
          onClose={() => (removeBusy ? undefined : setRemoving(null))}
        />
      )}
    </div>
  );
}
