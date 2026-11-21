"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Plus, Search, Trash2, Upload, Users, X, Building2, RefreshCw } from "lucide-react";

type Workspace = { id: string; name: string; slug: string; role: string };
type Contact = {
  id: string; full_name: string; email: string | null; company: string | null;
  job_title: string | null; source: string | null; notes: string | null;
  stage: "new" | "contacted" | "engaged" | "qualified" | "archived";
  location?: string | null; linkedin_url?: string | null; email_opt_in?: boolean; email_consent_note?: string | null;
  created_at: string; updated_at: string;
};

const stages = ["new", "contacted", "engaged", "qualified", "archived"] as const;
const blank = { full_name: "", email: "", company: "", job_title: "", location: "", linkedin_url: "", source: "manual", notes: "", stage: "new" as const, email_opt_in: false, email_consent_note: "" };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(value.trim()); value = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += ch;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export default function ContactsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [editing, setEditing] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load workspaces.");
    const list: Workspace[] = data.workspaces || [];
    setWorkspaces(list);
    if (!workspaceId && list.length) setWorkspaceId(list[0].id);
    return list;
  }, [workspaceId]);

  const loadContacts = useCallback(async (id: string) => {
    if (!id) { setContacts([]); return; }
    const response = await fetch("/api/contacts?workspace_id=" + encodeURIComponent(id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load contacts.");
    setContacts(data.contacts || []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/workspaces");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load workspaces.");
        if (!alive) return;
        const list: Workspace[] = data.workspaces || [];
        setWorkspaces(list);
        const selected = list[0]?.id || "";
        setWorkspaceId(selected);
        if (selected) {
          const r = await fetch("/api/contacts?workspace_id=" + encodeURIComponent(selected));
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Could not load contacts.");
          if (alive) setContacts(d.contacts || []);
        }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Unable to load CRM."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function refresh() {
    setError(""); setBusy(true);
    try { await loadWorkspaces(); await loadContacts(workspaceId); }
    catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { setBusy(false); }
  }

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workspaceName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create workspace.");
      await loadWorkspaces();
      setWorkspaceId(data.workspace.id);
      setContacts([]);
      setWorkspaceName("");
    } catch (e) { setError(e instanceof Error ? e.message : "Workspace creation failed."); }
    finally { setBusy(false); }
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault(); if (!workspaceId) return;
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/contacts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, workspace_id: workspaceId, ...(editing ? { id: editing } : {}) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save contact.");
      setModal(false); setEditing(null); setForm({ ...blank }); await loadContacts(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); }
  }

  function editContact(contact: Contact) {
    setEditing(contact.id);
    setForm({
      full_name: contact.full_name, email: contact.email || "", company: contact.company || "",
      job_title: contact.job_title || "", location: contact.location || "", linkedin_url: contact.linkedin_url || "",
      source: contact.source || "manual", notes: contact.notes || "", stage: contact.stage,
      email_opt_in: contact.email_opt_in || false
    });
    setModal(true);
  }

  async function removeContact(contact: Contact) {
    if (!window.confirm("Delete " + contact.full_name + "? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/contacts?workspace_id=" + encodeURIComponent(workspaceId) + "&id=" + encodeURIComponent(contact.id), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete contact.");
      setContacts(old => old.filter(item => item.id !== contact.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    finally { setBusy(false); }
  }

  async function importCsv(file?: File) {
    if (!file || !workspaceId) return;
    setBusy(true); setError("");
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("CSV needs a header row and at least one contact.");
      const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      const index = (names: string[]) => headers.findIndex(h => names.includes(h));
      const nameI = index(["full_name", "name", "contact_name"]);
      if (nameI < 0) throw new Error("CSV must include a full_name or name column.");
      const mapped = rows.slice(1).filter(r => r[nameI]).map(r => ({
        full_name: r[nameI], email: r[index(["email", "email_address"])] || "",
        company: r[index(["company", "organization"])] || "", job_title: r[index(["job_title", "title", "position"])] || "",
        location: r[index(["location", "city"])] || "", linkedin_url: r[index(["linkedin_url", "profile_url"])] || "",
        source: "csv_import", notes: "", stage: "new", email_opt_in: false
      }));
      if (!mapped.length) throw new Error("No contact rows found in this CSV.");
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, contacts: mapped }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "CSV import failed.");
      await loadContacts(workspaceId);
      window.alert("Imported " + data.count + " contact(s). Email marketing consent was not assumed.");
    } catch (e) { setError(e instanceof Error ? e.message : "CSV import failed."); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    const columns = ["full_name", "email", "company", "job_title", "location", "linkedin_url", "stage", "source", "notes"];
    const quote = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [columns.join(","), ...contacts.map(c => columns.map(k => quote((c as any)[k])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "workforce-contacts.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => contacts.filter(c => [c.full_name, c.email, c.company, c.job_title, c.location, c.stage].join(" ").toLowerCase().includes(query.toLowerCase())), [contacts, query]);
  const currentRole = workspaces.find(w => w.id === workspaceId)?.role;

  return <main className="min-h-screen px-5 py-8 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Relationship management</p><h1 className="mt-2 text-3xl font-black">Contacts</h1><p className="mt-2 text-sm text-slate-500">Manage people and professional relationships in your workspace.</p></div>
        {workspaces.length > 0 && <div className="flex flex-wrap gap-2">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); loadContacts(e.target.value).catch(err => setError(err.message)); }}>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}
          </select>
          <button className="btn-outline" onClick={refresh} disabled={busy}><RefreshCw size={15}/> Refresh</button>
          <button className="btn-outline" onClick={exportCsv} disabled={!contacts.length}><Download size={15}/> Export</button>
          <label className="btn-outline cursor-pointer"><Upload size={15}/> Import CSV<input className="hidden" type="file" accept=".csv,text/csv" onChange={e => importCsv(e.target.files?.[0])}/></label>
          <button className="btn" onClick={() => { setEditing(null); setForm({ ...blank }); setModal(true); }}><Plus size={16}/> Add contact</button>
        </div>}
      </div>

      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? <div className="card mt-7 p-12 text-center text-sm text-slate-500">Loading your workspace…</div> : workspaces.length === 0 ? <section className="card mx-auto mt-8 max-w-xl p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Building2/></span>
        <h2 className="mt-4 text-xl font-black">Create your workspace</h2><p className="mt-2 text-sm leading-6 text-slate-500">A workspace keeps your contacts, team, and activity private from other organizations.</p>
        <form onSubmit={createWorkspace} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input required minLength={2} maxLength={120} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Company or workspace name" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}/>
          <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button>
        </form>
      </section> : <section className="card mt-7 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><p className="font-extrabold">Your people</p><p className="mt-1 text-xs text-slate-400">{contacts.length} saved contacts · role: {currentRole}</p></div>
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-64 max-w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm" placeholder="Search contacts…" value={query} onChange={e => setQuery(e.target.value)}/></div>
        </div>
        {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Person</th><th className="px-5 py-3">Company</th><th className="px-5 py-3">Location</th><th className="px-5 py-3">Stage</th><th className="px-5 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">
          {filtered.map(c => <tr key={c.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><button onClick={() => editContact(c)} className="text-left font-bold hover:text-violet-700">{c.full_name}</button><p className="mt-1 text-xs text-slate-400">{c.email || "No email saved"}{c.job_title ? " · " + c.job_title : ""}</p></td><td className="px-5 py-4 text-slate-600">{c.company || "—"}</td><td className="px-5 py-4 text-slate-600">{c.location || "—"}</td><td className="px-5 py-4"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold capitalize text-violet-700">{c.stage}</span></td><td className="px-5 py-4"><div className="flex gap-3"><button className="text-xs font-bold text-violet-700" onClick={() => editContact(c)}>Edit</button>{(currentRole === "owner" || currentRole === "admin") && <button aria-label={"Delete " + c.full_name} onClick={() => removeContact(c)} className="text-red-500"><Trash2 size={15}/></button>}</div></td></tr>)}
        </tbody></table></div> : <div className="flex flex-col items-center px-5 py-16 text-center"><Users size={28} className="text-slate-300"/><p className="mt-3 font-bold">{query ? "No matching contacts" : "Your CRM is ready"}</p><p className="mt-1 text-xs text-slate-400">{query ? "Try another search term." : "Add a person or import a CSV to get started."}</p></div>}
      </section>}
      <p className="mt-4 text-[11px] leading-5 text-slate-400">CSV imports do not grant email marketing consent. Only contact people when you have a lawful basis and follow applicable privacy and messaging rules.</p>
    </div>

    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" className="my-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 id="contact-modal-title" className="text-xl font-black">{editing ? "Edit contact" : "Add a contact"}</h2><button onClick={() => setModal(false)} aria-label="Close"><X/></button></div>
        <form onSubmit={saveContact} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">Full name *<input required maxLength={200} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.full_name} onChange={e => setForm({...form,full_name:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">Email<input type="email" maxLength={320} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">Company<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.company} onChange={e => setForm({...form,company:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">Job title<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.job_title} onChange={e => setForm({...form,job_title:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">Location<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.location} onChange={e => setForm({...form,location:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">LinkedIn / profile URL<input type="url" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.linkedin_url} onChange={e => setForm({...form,linkedin_url:e.target.value})}/></label>
          <label className="text-xs font-bold text-slate-600">Relationship stage<select className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal capitalize" value={form.stage} onChange={e => setForm({...form,stage:e.target.value as any})}>{stages.map(s=><option className="capitalize" key={s} value={s}>{s}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-600">Source<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.source} onChange={e => setForm({...form,source:e.target.value})}/></label>
          <label className="sm:col-span-2 text-xs font-bold text-slate-600">Notes<textarea rows={3} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})}/></label>
          <label className="sm:col-span-2 flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" className="mt-1" checked={form.email_opt_in} onChange={e => setForm({...form,email_opt_in:e.target.checked})}/> This person has expressly agreed to receive marketing emails. Do not tick unless you have recorded valid consent.</label>{form.email_opt_in && <label className="sm:col-span-2 text-xs font-bold text-slate-600">Consent evidence *<textarea required minLength={10} maxLength={1000} rows={2} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" placeholder="Record when and how consent was obtained, e.g. 21 Nov 2026 — opted in via our website signup form." value={form.email_consent_note} onChange={e => setForm({...form,email_consent_note:e.target.value})}/></label>}
          <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-outline" onClick={() => setModal(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add contact"}</button></div>
        </form>
      </section>
    </div>}
  </main>;
}
