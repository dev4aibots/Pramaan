'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users, UserPlus, Trash2, Copy, Check, Building, ShieldAlert,
  Eye, PlusCircle, LogIn, RefreshCw, KeyRound, X, Info, Repeat,
} from 'lucide-react';
import { Button, Card, Input, Label, Select, Badge, SectionTitle } from './ui';
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

const ROLE_TONE: Record<Role, 'indigo' | 'amber' | 'green' | 'zinc' | 'red'> = {
  owner: 'indigo', admin: 'amber', manager: 'green', member: 'zinc', viewer: 'zinc',
};

type Org = { id: string; name: string; kind: 'personal' | 'team'; role: Role };
type Member = { id: string; email: string; name: string; role: Role; subject_ref: string | null };

function WhyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" />
      <p>{children}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <div className="mt-2 text-sm text-zinc-300">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} className="gap-2">
            {busy && <RefreshCw size={14} className="animate-spin" />}
            {confirmLabel}
          </Button>
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
    <div className="space-y-6">
      <SectionTitle
        title="Team & Access Control"
        desc="Manage workspace members, assign RBAC roles, and bind subject IDs for row-level isolation."
      />

      {/* Current workspace status */}
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building className="text-indigo-400" size={20} />
            <h3 className="text-lg font-semibold text-white">{me.orgName}</h3>
            <Badge tone={isTeam ? 'indigo' : 'zinc'}>{me.orgKind}</Badge>
            <Badge tone={ROLE_TONE[me.role as Role] ?? 'zinc'}>{me.role}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="flex items-center gap-1"><Eye size={12} /> You see {isAdmin ? 'all members and can manage them' : 'your own membership (read-only)'}</span>
            {me.subjectRef && (
              <span>· Row identifier <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-zinc-200">{me.subjectRef}</code></span>
            )}
          </div>
        </div>
        {!isTeam && (
          <WhyNote>
            You are in your <strong>personal vault</strong>. Team features (member list, invites, role management) are hidden —
            create a team workspace below to invite members.
          </WhyNote>
        )}
      </Card>

      {/* Workspace switcher */}
      <Card>
        <div className="mb-3 flex items-center gap-2 font-medium text-white">
          <Repeat size={18} className="text-indigo-400" />
          Your Workspaces ({orgs.length})
        </div>
        {switchErr && <p role="alert" className="mb-3 text-sm text-red-400">{switchErr}</p>}
        {orgs.length === 0 ? (
          <p className="text-sm text-zinc-400">No workspaces found. Create one below to get started.</p>
        ) : (
          <div className="space-y-2">
            {orgs.map((o) => {
              const active = o.id === me.orgId;
              return (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate font-medium text-white">{o.name}</span>
                    <Badge tone={o.kind === 'team' ? 'indigo' : 'zinc'}>{o.kind}</Badge>
                    <Badge tone={ROLE_TONE[o.role] ?? 'zinc'}>{o.role}</Badge>
                    {active && <Badge tone="green">Current</Badge>}
                  </div>
                  {!active && (
                    <Button
                      variant="ghost"
                      onClick={() => switchOrg(o.id)}
                      disabled={!!switchingTo}
                      className="px-3 py-1 text-xs"
                    >
                      {switchingTo === o.id ? <RefreshCw size={14} className="animate-spin" /> : 'Switch'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {isTeam ? (
        <>
          {/* Member list */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium text-white">
                <Users size={18} className="text-indigo-400" />
                Members ({members.length})
              </div>
              {loadingMembers && (
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <RefreshCw size={12} className="animate-spin" /> Loading…
                </span>
              )}
            </div>

            {membersErr && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">
                <span role="alert">{membersErr}</span>
                <Button variant="ghost" onClick={loadMembers} className="px-3 py-1 text-xs">Retry</Button>
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
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                    <th scope="col" className="py-2 pr-3 font-medium">Member</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Row identifier</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2 font-medium text-white">
                          {m.name || m.email}
                          {m.id === me.userId && <Badge tone="zinc">You</Badge>}
                        </div>
                        <div className="text-xs text-zinc-400">{m.email}</div>
                      </td>
                      <td className="py-3 pr-3">
                        {editable(m) ? (
                          <div>
                            <Select
                              value={m.role}
                              aria-label={`Role for ${m.email}`}
                              onChange={(e) => updateMember(m.id, e.target.value, m.subject_ref)}
                              className="w-32 py-1.5 text-xs"
                            >
                              {ROLES.filter((r) => r !== 'owner').map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </Select>
                            <p className="mt-1 max-w-xs text-[11px] leading-snug text-zinc-500">
                              {ROLE_PRIVILEGES[m.role]}
                            </p>
                          </div>
                        ) : (
                          <span title={ROLE_PRIVILEGES[m.role]}><Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge></span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {editable(m) ? (
                          <Input
                            key={`${m.id}-${m.subject_ref}`}
                            placeholder="e.g. S1023"
                            defaultValue={m.subject_ref || ''}
                            aria-label={`Row identifier for ${m.email}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null;
                              if (v !== m.subject_ref) updateMember(m.id, m.role, v);
                            }}
                            className="w-32 py-1.5 text-xs"
                          />
                        ) : m.subject_ref ? (
                          <code className="rounded-full bg-indigo-500/15 px-2 py-0.5 font-mono text-xs text-indigo-300">{m.subject_ref}</code>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {editable(m) ? (
                          <Button
                            variant="ghost"
                            onClick={() => setRemoving(m)}
                            aria-label={`Remove ${m.email}`}
                            title="Remove member"
                            className="px-2.5 py-1.5"
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : m.role === 'owner' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500" title="The workspace owner cannot be removed or demoted">
                            <ShieldAlert size={12} /> protected
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {members.length === 0 && !loadingMembers && !membersErr && (
                <p className="py-6 text-center text-sm text-zinc-500">No members yet. Create an invite below to bring people in.</p>
              )}
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {members.map((m) => (
                <div key={m.id} className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-white">
                        <span className="truncate">{m.name || m.email}</span>
                        {m.id === me.userId && <Badge tone="zinc">You</Badge>}
                      </div>
                      <div className="truncate text-xs text-zinc-400">{m.email}</div>
                    </div>
                    <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                  </div>
                  {m.subject_ref && (
                    <div className="mt-2 text-xs text-zinc-400">
                      Row ID: <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-zinc-200">{m.subject_ref}</code>
                    </div>
                  )}
                  {editable(m) && (
                    <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                      <div>
                        <Label>Role</Label>
                        <Select
                          value={m.role}
                          aria-label={`Role for ${m.email}`}
                          onChange={(e) => updateMember(m.id, e.target.value, m.subject_ref)}
                        >
                          {ROLES.filter((r) => r !== 'owner').map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </Select>
                        <p className="mt-1 text-[11px] leading-snug text-zinc-500">{ROLE_PRIVILEGES[m.role]}</p>
                      </div>
                      <div>
                        <Label>Row identifier</Label>
                        <Input
                          key={`${m.id}-mobile-${m.subject_ref}`}
                          placeholder="e.g. S1023 (Roll / Emp ID)"
                          defaultValue={m.subject_ref || ''}
                          aria-label={`Row identifier for ${m.email}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== m.subject_ref) updateMember(m.id, m.role, v);
                          }}
                        />
                      </div>
                      <Button variant="danger" onClick={() => setRemoving(m)} className="w-full py-1.5 text-xs">
                        <Trash2 size={14} /> Remove member
                      </Button>
                    </div>
                  )}
                  {m.role === 'owner' && isAdmin && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500">
                      <ShieldAlert size={12} /> The owner is protected and cannot be removed or demoted.
                    </p>
                  )}
                </div>
              ))}
              {members.length === 0 && !loadingMembers && !membersErr && (
                <p className="py-6 text-center text-sm text-zinc-500">No members yet. Create an invite below to bring people in.</p>
              )}
            </div>
          </Card>

          {/* Invite generator */}
          {isAdmin ? (
            <Card>
              <div className="mb-1 flex items-center gap-2 font-medium text-white">
                <UserPlus size={18} className="text-indigo-400" />
                Generate Workspace Invite
              </div>
              <p className="mb-4 text-xs text-zinc-400">
                Share the code with the person you want to invite. They join via the “Join Workspace” form below.
              </p>

              <form onSubmit={createInvite} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>Role to grant</Label>
                    <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}>
                      <option value="viewer">Viewer — read-only</option>
                      <option value="member">Member — upload & chat</option>
                      <option value="manager">Manager — share docs, invite</option>
                      {me.role === 'owner' && <option value="admin">Admin — manage members</option>}
                    </Select>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">{ROLE_PRIVILEGES[inviteRole]}</p>
                  </div>
                  <div>
                    <Label>Row security ID (optional)</Label>
                    <Input
                      placeholder="e.g. S1023 (Roll / Emp ID)"
                      value={inviteSubject}
                      onChange={(e) => setInviteSubject(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      Binds the new member to their own rows — they only see chunks tagged with this ID.
                    </p>
                  </div>
                  <div>
                    <Label>Max uses</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={inviteMaxUses}
                      onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                    />
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      How many people can join with this code before it is exhausted.
                    </p>
                  </div>
                </div>

                {inviteErr && <p role="alert" className="text-sm text-red-400">{inviteErr}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={creatingInvite} className="gap-2">
                    <KeyRound size={16} />
                    {creatingInvite ? 'Creating…' : 'Create Invite Code'}
                  </Button>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <Info size={12} /> Invite codes expire 7 days after creation.
                  </span>
                </div>
              </form>

              {generatedCode && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3">
                  <div className="min-w-0">
                    <div className="text-xs text-indigo-300">Share this code with the invitee:</div>
                    <div className="select-all font-mono text-sm font-semibold text-white">{generatedCode}</div>
                  </div>
                  <Button variant="ghost" onClick={copyCode} className="gap-1">
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy Code'}
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card>
              <div className="mb-2 flex items-center gap-2 font-medium text-white">
                <UserPlus size={18} className="text-indigo-400" />
                Invite Members
              </div>
              <WhyNote>
                Invites are available to <strong>admins and the owner</strong>. Your role is <strong>{me.role}</strong> —
                ask an admin for an invite code if you need to bring someone in.
              </WhyNote>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <div className="mb-2 flex items-center gap-2 font-medium text-white">
            <Users size={18} className="text-indigo-400" />
            Members & Invites
          </div>
          <WhyNote>
            This is your <strong>personal vault</strong> — it holds only your own documents and has no members.
            To invite people, assign roles, or use row-level security, create a <strong>team workspace</strong> below.
          </WhyNote>
        </Card>
      )}

      {/* Create or join workspace */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2 font-medium text-white">
            <PlusCircle size={18} className="text-indigo-400" />
            Create Team Workspace
          </div>
          <p className="mb-3 text-xs text-zinc-400">
            Create an isolated organization workspace with team RBAC and row-level sharing. You become its owner.
          </p>
          <form onSubmit={createOrg} className="space-y-3">
            <Input
              placeholder="Workspace name (e.g. Acme Legal)"
              required
              minLength={2}
              maxLength={80}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              aria-label="New workspace name"
            />
            {createErr && <p role="alert" className="text-xs text-red-400">{createErr}</p>}
            <Button type="submit" disabled={creatingOrg || !orgName.trim()} className="gap-2">
              {creatingOrg && <RefreshCw size={14} className="animate-spin" />}
              {creatingOrg ? 'Creating…' : 'Create Team Workspace'}
            </Button>
          </form>
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-2 font-medium text-white">
            <LogIn size={18} className="text-indigo-400" />
            Join Workspace with Code
          </div>
          <p className="mb-3 text-xs text-zinc-400">
            Enter an invite code (PRM-XXXX) from a workspace administrator. You take the role and row ID the code was issued for.
          </p>
          <form onSubmit={joinOrg} className="space-y-3">
            <Input
              placeholder="e.g. PRM-a1b2c3d4"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              aria-label="Invite code"
            />
            {joinErr && <p role="alert" className="text-xs text-red-400">{joinErr}</p>}
            <Button type="submit" variant="ghost" disabled={joining || !joinCode.trim()} className="gap-2">
              {joining && <RefreshCw size={14} className="animate-spin" />}
              {joining ? 'Joining…' : 'Join Workspace'}
            </Button>
          </form>
        </Card>
      </div>

      {/* Remove member confirmation */}
      {removing && (
        <ConfirmModal
          title="Remove member?"
          body={
            <p>
              Remove <strong className="text-white">{removing.name || removing.email}</strong> ({removing.email}) from
              the workspace <strong className="text-white">{me.orgName}</strong>? They lose access immediately and must
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
