"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, UserPlus, MailCheck, ExternalLink } from "lucide-react";

type Workspace = { id: string; name: string };
type Person = { full_name: string; email: string | null; company: string | null; job_title: string | null; location: string | null; linkedin_url: string | null; source: string };

export default function SearchPage() {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [workspaceId,setWorkspaceId]=useState("");
  const [query,setQuery]=useState("");
  const [title,setTitle]=useState("");
  const [company,setCompany]=useState("");
  const [location,setLocation]=useState("");
  const [people,setPeople]=useState<Person[]>([]);
  const [usage,setUsage]=useState<{used:number;quota:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [verification,setVerification]=useState<Record<string,string>>({});
  const [saved,setSaved]=useState<Record<string,boolean>>({});

  useEffect(()=>{fetch("/api/workspaces").then(r=>r.json()).then(d=>{setWorkspaces(d.workspaces||[]);setWorkspaceId(d.workspaces?.[0]?.id||"");if(d.error)setError(d.error);}).catch(()=>setError("Could not load workspace."));},[]);

  async function search(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");setPeople([]);setVerification({});setSaved({});
    try{const r=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace_id:workspaceId,query,title,company,location})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Search failed.");setPeople(d.people||[]);setUsage(d.usage||null);}
    catch(e){setError(e instanceof Error?e.message:"Search failed.");}finally{setBusy(false);}
  }

  async function save(person:Person){
    setError("");
    try{const r=await fetch("/api/contacts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace_id:workspaceId,...person,stage:"new",email_opt_in:false})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save contact.");setSaved(old=>({...old,[person.full_name]:true}));}
    catch(e){setError(e instanceof Error?e.message:"Could not save contact.");}
  }

  async function verify(person:Person){
    setVerification(old=>({...old,[person.full_name]:"Checking…"}));
    try{const r=await fetch("/api/email/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace_id:workspaceId,email:person.email})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Verification unavailable.");setVerification(old=>({...old,[person.full_name]:d.status+(d.score!==null?" · score "+d.score:"")}));}
    catch(e){setVerification(old=>({...old,[person.full_name]:e instanceof Error?e.message:"Verification failed."}));}
  }

  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6"><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Professional discovery</p><h1 className="mt-2 text-3xl font-black">People search</h1><p className="mt-2 text-sm text-slate-500">Search through a connected, licensed data provider and save relevant people to your CRM.</p></div>
    {error&&<div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
    <form onSubmit={search} className="card mt-6 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-bold text-slate-600 sm:col-span-2">Keywords<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder="e.g. product designer, data analyst" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="text-xs font-bold text-slate-600">Job title<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="text-xs font-bold text-slate-600">Company<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={company} onChange={e=>setCompany(e.target.value)}/></label>
      <label className="text-xs font-bold text-slate-600">Location<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={location} onChange={e=>setLocation(e.target.value)}/></label>
      <label className="text-xs font-bold text-slate-600">Workspace<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="flex items-end"><button disabled={busy||!workspaceId} className="btn w-full"><Search size={15}/>{busy?"Searching…":"Search professionals"}</button></div>
    </form>
    {usage&&<p className="mt-3 text-xs text-slate-400">Search usage this month: {usage.used} / {usage.quota}</p>}
    {people.length>0&&<div className="mt-6 grid gap-4 md:grid-cols-2">{people.map((p,i)=><article key={p.full_name+i} className="card p-5"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 font-black text-violet-700">{p.full_name.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><h2 className="font-extrabold">{p.full_name}</h2><p className="mt-1 text-xs text-slate-500">{[p.job_title,p.company].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-slate-400">{p.location||"Location not supplied"}</p></div>{p.linkedin_url&&<a href={p.linkedin_url} target="_blank" rel="noreferrer" aria-label="Open profile" className="text-violet-700"><ExternalLink size={16}/></a>}</div>
      <p className="mt-4 text-sm text-slate-600">{p.email||"No email supplied by provider"}</p>{verification[p.full_name]&&<p className="mt-2 text-xs text-slate-500">Email check: {verification[p.full_name]}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={saved[p.full_name]} onClick={()=>save(p)} className="btn"><UserPlus size={14}/>{saved[p.full_name]?"Saved":"Save to CRM"}</button>{p.email&&<button onClick={()=>verify(p)} className="btn-outline"><MailCheck size={14}/> Verify email</button>}</div>
      <p className="mt-3 text-[10px] text-slate-400">Source: {p.source}</p>
    </article>)}</div>}
    <p className="mt-5 text-xs leading-5 text-slate-400">Search is not enabled until a licensed provider is configured. This app does not scrape LinkedIn or bypass platform restrictions. Saving a person does not imply consent to marketing email.</p>
  </div></main>;
}
