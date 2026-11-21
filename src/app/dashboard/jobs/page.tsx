"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Plus, ExternalLink, Trash2, ClipboardCheck } from "lucide-react";

type Workspace = { id: string; name: string; role: string };
type Job = { id: string; title: string; company: string | null; location: string | null; employment_type: string | null; source_url: string | null; description: string; status: string; applications: { id: string; status: string; notes: string | null }[] };

const jobStages = ["saved", "interested", "applied", "interviewing", "closed"];
const appStages = ["planned", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];
const empty = { title: "", company: "", location: "", employment_type: "Full-time", source_url: "", description: "" };

export default function JobsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const [jr, ar] = await Promise.all([
      fetch("/api/jobs?workspace_id=" + encodeURIComponent(id)),
      fetch("/api/applications?workspace_id=" + encodeURIComponent(id))
    ]);
    const jd = await jr.json(), ad = await ar.json();
    if (!jr.ok) throw new Error(jd.error || "Could not load jobs.");
    if (!ar.ok) throw new Error(ad.error || "Could not load applications.");
    const apps = ad.applications || [];
    setJobs((jd.jobs || []).map((job: any) => ({ ...job, applications: apps.filter((a: any) => a.job_id === job.id) })));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/workspaces"), d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load workspace.");
        if (!alive) return;
        const list = d.workspaces || []; setWorkspaces(list);
        const id = list[0]?.id || ""; setWorkspaceId(id);
        if (id) await load(id);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Could not load jobs."); }
    })();
    return () => { alive = false; };
  }, [load]);

  async function addJob(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, workspace_id: workspaceId }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not save job.");
      setForm(empty); setShowForm(false); await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); }
  }

  async function changeJob(job: Job, status: string) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, id: job.id, status }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Update failed."); await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    finally { setBusy(false); }
  }

  async function createApplication(job: Job) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, job_id: job.id }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not track application."); await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not track application."); }
    finally { setBusy(false); }
  }

  async function changeApplication(job: Job, appId: string, status: string) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/applications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, id: appId, status }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Application update failed."); await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Application update failed."); }
    finally { setBusy(false); }
  }

  async function remove(job: Job) {
    if (!window.confirm("Delete this saved job and its application records?")) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/jobs?workspace_id=" + encodeURIComponent(workspaceId) + "&id=" + encodeURIComponent(job.id), { method: "DELETE" });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Delete failed."); await load(workspaceId);
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    finally { setBusy(false); }
  }

  const role = workspaces.find(w => w.id === workspaceId)?.role;
  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard/job-search" className="btn-outline mb-4 inline-flex"><Search size={14}/> Search job listings</Link>\n    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Career pipeline</p><h1 className="mt-2 text-3xl font-black">Jobs & applications</h1><p className="mt-2 text-sm text-slate-500">Save job listings you are authorized to use and track each application.</p></div>
      {workspaces.length > 0 && <div className="flex gap-2"><select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); load(e.target.value).catch(err => setError(err.message)); }}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className="btn" onClick={() => setShowForm(v => !v)}><Plus size={16}/> Add job</button></div>}
    </div>
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {showForm && <form onSubmit={addJob} className="card mt-6 grid gap-3 p-5 sm:grid-cols-2"><h2 className="sm:col-span-2 font-extrabold">Save a job</h2>
      <label className="text-xs font-bold text-slate-600">Job title *<input required minLength={2} maxLength={200} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.title} onChange={e => setForm({...form,title:e.target.value})}/></label>
      <label className="text-xs font-bold text-slate-600">Company<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.company} onChange={e => setForm({...form,company:e.target.value})}/></label>
      <label className="text-xs font-bold text-slate-600">Location<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.location} onChange={e => setForm({...form,location:e.target.value})}/></label>
      <label className="text-xs font-bold text-slate-600">Employment type<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.employment_type} onChange={e => setForm({...form,employment_type:e.target.value})}/></label>
      <label className="text-xs font-bold text-slate-600 sm:col-span-2">Job source URL<input type="url" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.source_url} onChange={e => setForm({...form,source_url:e.target.value})}/></label>
      <label className="text-xs font-bold text-slate-600 sm:col-span-2">Description / notes<textarea rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" value={form.description} onChange={e => setForm({...form,description:e.target.value})}/></label>
      <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button><button disabled={busy} className="btn">Save job</button></div>
    </form>}
    {!workspaces.length ? <section className="card mt-7 p-12 text-center text-sm text-slate-500">Create a workspace before saving jobs. <Link href="/dashboard/contacts" className="font-bold text-violet-700">Open CRM</Link>.</section> : jobs.length ? <div className="mt-6 grid gap-4 md:grid-cols-2">{jobs.map(job => <article key={job.id} className="card p-5">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-violet-50 p-3 text-violet-700"><BriefcaseBusiness size={20}/></span><div className="min-w-0 flex-1"><h2 className="font-extrabold">{job.title}</h2><p className="mt-1 text-xs text-slate-500">{[job.company,job.location,job.employment_type].filter(Boolean).join(" · ") || "Job details not provided"}</p></div>{(role === "owner" || role === "admin") && <button aria-label="Delete job" onClick={() => remove(job)} className="text-red-500"><Trash2 size={16}/></button>}</div>
      {job.description && <p className="mt-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">{job.description.slice(0,500)}{job.description.length>500?"…":""}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4"><label className="text-[11px] font-bold text-slate-500">Pipeline<select className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs capitalize" value={job.status} onChange={e => changeJob(job,e.target.value)}>{jobStages.map(s=><option key={s} value={s}>{s}</option>)}</select></label>{job.source_url && <a href={job.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-violet-700">Original listing <ExternalLink size={13}/></a>}</div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-xs font-extrabold"><ClipboardCheck size={15}/> Application tracker</p>{!job.applications.length && <button disabled={busy} onClick={() => createApplication(job)} className="text-xs font-bold text-violet-700">+ Track application</button>}</div>
        {job.applications.map(app => <div key={app.id} className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">Application status</span><select aria-label="Application status" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs capitalize" value={app.status} onChange={e => changeApplication(job,app.id,e.target.value)}>{appStages.map(s=><option key={s} value={s}>{s}</option>)}</select></div>)}
      </div>
    </article>)}</div> : <section className="card mt-7 flex flex-col items-center p-14 text-center"><BriefcaseBusiness className="text-slate-300" size={30}/><h2 className="mt-3 font-extrabold">Your career tracker is ready</h2><p className="mt-1 text-xs text-slate-400">Save jobs from sources you are permitted to use, then track your application progress.</p></section>}
    <p className="mt-4 text-xs leading-5 text-slate-400">This version supports manually saved listings and application tracking. Automated discovery requires a licensed job-feed provider and is not simulated.</p>
  </div></main>;
}
