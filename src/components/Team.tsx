'use client';
import { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Shield, Trash2, Copy, Check, Building } from 'lucide-react';
import { Button, Card, Input, Label, Select, Badge, SectionTitle } from './ui';
import { api } from '@/lib/client/api';
import { type Role } from '@/lib/auth';

const ROLES: Role[] = ['owner', 'admin', 'manager', 'member', 'viewer'];

export default function Team({ me, reload }: { me: any; reload: () => Promise<void> }) {
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Invite creation
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'member' | 'viewer'>('member');
  const [inviteSubject, setInviteSubject] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteErr, setInviteErr] = useState('');

  // Org creation
  const [orgName, setOrgName] = useState('');
  const [createErr, setCreateErr] = useState('');

  // Join Org
  const [joinCode, setJoinCode] = useState('');
  const [joinErr, setJoinErr] = useState('');

  const isAdmin = me?.role === 'owner' || me?.role === 'admin';

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const res = await api('/api/members');
      setMembers(res.members || []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers, me.orgId]);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr('');
    try {
      await api('/api/orgs', { body: { name: orgName.trim() } });
      setOrgName('');
      await reload();
    } catch (err: any) {
      setCreateErr(err.message);
    }
  }

  async function joinOrg(e: React.FormEvent) {
    e.preventDefault();
    setJoinErr('');
    try {
      await api('/api/orgs/join', { body: { code: joinCode.trim() } });
      setJoinCode('');
      await reload();
    } catch (err: any) {
      setJoinErr(err.message);
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr('');
    try {
      const r = await api('/api/invites', {
        body: {
          role: inviteRole,
          subjectRef: inviteSubject.trim() || null,
          maxUses: Number(inviteMaxUses),
        },
      });
      setGeneratedCode(r.code);
    } catch (err: any) {
      setInviteErr(err.message);
    }
  }

  async function updateMember(userId: string, role: string, subjectRef: string | null) {
    try {
      await api('/api/members', {
        method: 'PATCH',
        body: { userId, role, subjectRef },
      });
      loadMembers();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function removeMember(userId: string) {
    if (confirm('Remove this member from workspace?')) {
      try {
        await api(`/api/members?userId=${userId}`, { method: 'DELETE' });
        loadMembers();
      } catch (err: any) {
        alert(err.message);
      }
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Team & Access Control"
        desc="Manage workspace members, assign RBAC roles, and bind subject IDs for row-level isolation."
      />

      {/* Current Workspace status */}
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building className="text-indigo-400" size={20} />
            <h3 className="text-lg font-semibold text-white">{me.orgName}</h3>
            <Badge tone={me.orgKind === 'personal' ? 'zinc' : 'indigo'}>{me.orgKind}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span>Your role: <strong className="text-zinc-200">{me.role}</strong></span>
            {me.subjectRef && <span>· Row identifier: <strong className="text-zinc-200">{me.subjectRef}</strong></span>}
          </div>
        </div>
      </Card>

      {/* Team Members List */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-white">
            <Users size={18} className="text-indigo-400" />
            Members ({members.length})
          </div>
          {loadingMembers && <span className="text-xs text-zinc-500">Loading...</span>}
        </div>

        <div className="divide-y divide-white/5">
          {members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="flex items-center gap-2 font-medium text-white">
                  {m.name || m.email}
                  {m.id === me.userId && <Badge tone="zinc">You</Badge>}
                </div>
                <div className="text-xs text-zinc-400">
                  {m.email} {m.subject_ref && `· Subject: ${m.subject_ref}`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isAdmin && m.role !== 'owner' && m.id !== me.userId ? (
                  <>
                    <Select
                      value={m.role}
                      onChange={(e) => updateMember(m.id, e.target.value, m.subject_ref)}
                      className="w-32 py-1 text-xs"
                    >
                      {ROLES.filter((r) => r !== 'owner').map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder="Subject ID"
                      defaultValue={m.subject_ref || ''}
                      onBlur={(e) => {
                        if (e.target.value !== (m.subject_ref || '')) {
                          updateMember(m.id, m.role, e.target.value.trim() || null);
                        }
                      }}
                      className="w-28 py-1 text-xs"
                    />
                    <Button variant="ghost" onClick={() => removeMember(m.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'indigo' : 'zinc'}>{m.role}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Invite Member Section (Team Admins) */}
      {isAdmin && me.orgKind === 'team' && (
        <Card>
          <div className="mb-4 flex items-center gap-2 font-medium text-white">
            <UserPlus size={18} className="text-indigo-400" />
            Generate Workspace Invite
          </div>

          <form onSubmit={createInvite} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Role to Grant</Label>
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                >
                  <option value="viewer">Viewer (Read-only)</option>
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  {me.role === 'owner' && <option value="admin">Admin</option>}
                </Select>
              </div>
              <div>
                <Label>Row Security ID (Optional)</Label>
                <Input
                  placeholder="e.g. S1023 (Roll / Emp ID)"
                  value={inviteSubject}
                  onChange={(e) => setInviteSubject(e.target.value)}
                />
              </div>
              <div>
                <Label>Max Uses</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={inviteMaxUses}
                  onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                />
              </div>
            </div>

            {inviteErr && <p className="text-sm text-red-400">{inviteErr}</p>}
            <Button>Create Invite Code</Button>
          </form>

          {generatedCode && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3">
              <div>
                <div className="text-xs text-indigo-300">Share this one-time code:</div>
                <div className="font-mono text-sm font-semibold text-white">{generatedCode}</div>
              </div>
              <Button variant="ghost" onClick={copyCode} className="gap-1">
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy Code'}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Create or Join workspace */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <div className="mb-2 font-medium text-white">Create New Team Workspace</div>
          <p className="mb-3 text-xs text-zinc-400">
            Create an isolated organization workspace with team RBAC and role sharing.
          </p>
          <form onSubmit={createOrg} className="space-y-3">
            <Input
              placeholder="Workspace name (e.g. Acme Legal)"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            {createErr && <p className="text-xs text-red-400">{createErr}</p>}
            <Button>Create Team Workspace</Button>
          </form>
        </Card>

        <Card>
          <div className="mb-2 font-medium text-white">Join Workspace with Code</div>
          <p className="mb-3 text-xs text-zinc-400">
            Enter an invitation code (PRM-XXXX) provided by your workspace administrator.
          </p>
          <form onSubmit={joinOrg} className="space-y-3">
            <Input
              placeholder="e.g. PRM-a1b2c3d4"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            {joinErr && <p className="text-xs text-red-400">{joinErr}</p>}
            <Button variant="ghost">Join Workspace</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
