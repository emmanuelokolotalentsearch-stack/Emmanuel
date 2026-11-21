"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, Users, RefreshCw, Trash2 } from "lucide-react";

type Workspace = { id: string; name: string; role: string };
type Member = { user_id: string; email: string; role: "owner" | "admin" | "member" | "viewer"; created_at: string };

export default function TeamPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const current = workspaces.find(w => w.id === workspaceId);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const response = await fetch("/api/team?workspace_id=" + encodeURIComponent(id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load team.");
    setMembers(data.members || []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/workspaces");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load workspaces.");
        const list: Workspace[] = d.workspaces || [];
        if (!active) return;
        setWorkspaces(list);
        const id = list.find(w => ["owner", "admin"].includes(w.role))?.id || "";
        setWorkspaceId(id);
        if (id) await load(id);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Unable to load team."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, email, role }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Invitation failed.");
      setEmail(""); await load(workspaceId); window.alert("Invitation sent to " + d.email + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Invitation failed."); }
    finally { setBusy(false); }
  }

  async function changeRole(member: Member, newRole: string) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, user_id: member.user_id, role: newRole }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Role update failed.");
      await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Role update failed."); }
    finally { setBusy(false); }
  }

  async function remove(member: Member) {
    if (!window.confirm("Remove " + member.email + " from this workspace?")) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/team?workspace_id=" + encodeURIComponent(workspaceId) + "&user_id=" + encodeURIComponent(member.user_id), { method: "DELETE" });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not remove member.");
      await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Remove failed."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-5xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Workspace administration</p><h1 className="mt-2 text-3xl font-black">Team members</h1><p className="mt-2 text-sm text-slate-500">Invite collaborators and manage their workspace access.</p></div>
      {workspaces.length > 0 && <select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); load(e.target.value).catch(err => setError(err.message)); }}>{workspaces.filter(w => ["owner", "admin"].includes(w.role)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
    </div>
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="card mt-7 p-10 text-center text-sm text-slate-500">Loading team…</div> : !workspaceId ? <div className="card mt-7 p-8 text-sm text-slate-600">You need to be a workspace owner or administrator to manage team members. <Link className="font-bold text-violet-700" href="/dashboard/contacts">Create a workspace</Link> or ask its owner for access.</div> : <>
      <form onSubmit={invite} className="card mt-7 grid gap-3 p-5 sm:grid-cols-[1fr_160px_auto]">
        <label className="text-xs font-bold text-slate-600">Email address<input required type="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder="colleague@company.com" value={email} onChange={e => setEmail(e.target.value)}/></label>
        <label className="text-xs font-bold text-slate-600">Workspace role<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={role} onChange={e => setRole(e.target.value)}><option value="member">Member</option><option value="viewer">Viewer</option>{current?.role === "owner" && <option value="admin">Admin</option>}</select></label>
        <button disabled={busy} className="btn self-end"><UserPlus size={16}/>{busy ? "Sending…" : "Invite member"}</button>
      </form>
      <section className="card mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-extrabold">Workspace access</h2><p className="mt-1 text-xs text-slate-400">{members.length} member(s)</p></div><button onClick={() => load(workspaceId).catch(e => setError(e.message))} className="btn-outline"><RefreshCw size={14}/> Refresh</button></div>
        {members.length ? <div className="divide-y divide-slate-100">{members.map(m => <div key={m.user_id} className="flex flex-wrap items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 text-violet-700"><Users size={17}/></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{m.email}</p><p className="mt-1 text-[11px] text-slate-400">Added {new Date(m.created_at).toLocaleDateString()}</p></div>{m.role === "owner" ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Owner</span> : current?.role === "owner" ? <select aria-label={"Role for " + m.email} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs capitalize" value={m.role} onChange={e => changeRole(m,e.target.value)}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-600">{m.role}</span>}{(current?.role === "owner" || (current?.role === "admin" && m.role !== "owner")) && <button aria-label={"Remove " + m.email} onClick={() => remove(m)} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={16}/></button>}</div>)}</div> : <div className="p-12 text-center text-sm text-slate-500">No team members found.</div>}
      </section>
      <p className="mt-4 text-xs leading-5 text-slate-400">Invitations require Supabase email delivery to be configured. The invited person will need to accept the invitation and sign in before accessing the workspace.</p>
    </>}
  </div></main>;
}
