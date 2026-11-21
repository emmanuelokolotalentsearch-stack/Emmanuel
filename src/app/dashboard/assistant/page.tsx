"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainCircuit, Copy, Sparkles } from "lucide-react";

type Workspace = { id: string; name: string };
const tasks = [
  { value: "assistant", label: "Workspace assistant", hint: "Ask about professional search, recruitment workflows, or planning." },
  { value: "profile_analysis", label: "Profile analysis", hint: "Review supplied professional profile information for role-relevant evidence." },
  { value: "outreach_draft", label: "Outreach drafting", hint: "Draft respectful professional outreach based only on facts you provide." },\n  { value: "job_match", label: "Job matching", hint: "Compare user-supplied candidate evidence with job requirements and identify matches, gaps, and interview questions." }
];

export default function AssistantPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [task, setTask] = useState("assistant");
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [output, setOutput] = useState("");
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/workspaces").then(r => r.json()).then(d => {
      if (d.workspaces?.length) { setWorkspaces(d.workspaces); setWorkspaceId(d.workspaces[0].id); }
      else if (d.error) setError(d.error);
    }).catch(() => setError("Could not load workspaces."));
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setOutput("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, task, input, context }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed.");
      setOutput(data.output); setUsage(data.usage || null);
    } catch (e) { setError(e instanceof Error ? e.message : "AI request failed."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-4xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6"><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">AI tools</p><h1 className="mt-2 text-3xl font-black">AI assistant</h1><p className="mt-2 text-sm text-slate-500">Analyze user-provided profile information and draft professional messages with human review.</p></div>
    {error && <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
    <form onSubmit={generate} className="card mt-7 space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">Workspace<select required className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-600">AI task<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={task} onChange={e => setTask(e.target.value)}>{tasks.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      </div>
      <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">{tasks.find(t=>t.value===task)?.hint}</p>
      <label className="block text-xs font-bold text-slate-600">Your instruction / profile information<textarea required minLength={3} maxLength={12000} rows={7} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder={task==="profile_analysis"?"Paste the professional profile or resume details you are authorized to process…":task==="outreach_draft"?"Describe the purpose of your outreach and the role or opportunity…":task==="job_match"?"Paste the job description or role requirements…":"What would you like help with?"} value={input} onChange={e => setInput(e.target.value)}/></label>
      <label className="block text-xs font-bold text-slate-600">Additional context (optional)<textarea maxLength={12000} rows={3} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder={task==="job_match"?"Paste the candidate’s resume or experience details here. Exclude personal identifiers and sensitive characteristics.":"Add role requirements, company context, or constraints. Do not include sensitive personal data."} value={context} onChange={e => setContext(e.target.value)}/></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-slate-400">AI output can be wrong. Review all assessments and messages before use.</p><button disabled={busy || !workspaceId || input.trim().length<3} className="btn"><Sparkles size={16}/>{busy ? "Generating…" : "Generate with AI"}</button></div>
    </form>
    {output && <section className="card mt-5 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-extrabold"><BrainCircuit size={18} className="text-violet-700"/> Generated result</h2><button className="btn-outline" onClick={() => navigator.clipboard.writeText(output)}><Copy size={14}/> Copy</button></div><div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{output}</div>{usage && <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-slate-400">Monthly AI usage for this feature: {usage.used} / {usage.quota}</p>}</section>}
  </div></main>;
}
