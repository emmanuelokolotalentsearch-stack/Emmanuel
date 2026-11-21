"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Search, MapPin, BriefcaseBusiness, ExternalLink, BookmarkPlus, CheckCircle2 } from "lucide-react";

type Workspace={id:string;name:string};
type Job={title:string;company:string|null;location:string|null;employment_type:string|null;source_url:string;description:string;source:string};
export default function JobSearchPage(){
 const [workspaces,setWorkspaces]=useState<Workspace[]>([]);const [workspaceId,setWorkspaceId]=useState("");
 const [query,setQuery]=useState("");const [location,setLocation]=useState("");const [employmentType,setEmploymentType]=useState("");
 const [jobs,setJobs]=useState<Job[]>([]);const [saved,setSaved]=useState<Record<string,boolean>>({});const [usage,setUsage]=useState<{used:number;quota:number}|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{fetch("/api/workspaces").then(r=>r.json()).then(d=>{setWorkspaces(d.workspaces||[]);setWorkspaceId(d.workspaces?.[0]?.id||"");if(d.error)setError(d.error);}).catch(()=>setError("Could not load workspaces."));},[]);
 async function search(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError("");setJobs([]);setSaved({});
  try{const r=await fetch("/api/job-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace_id:workspaceId,query,location,employment_type:employmentType})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Job search failed.");setJobs(d.jobs||[]);setUsage(d.usage||null);}
  catch(e){setError(e instanceof Error?e.message:"Job search failed.");}finally{setBusy(false);}
 }
 async function save(job:Job){
  setError("");
  try{const r=await fetch("/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace_id:workspaceId,title:job.title,company:job.company,location:job.location,employment_type:job.employment_type,source_url:job.source_url,description:job.description,status:"saved"})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save job.");setSaved(old=>({...old,[job.source_url]:true}));}
  catch(e){setError(e instanceof Error?e.message:"Could not save job.");}
 }
 return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
  <Link href="/dashboard/jobs" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Job tracker</Link>
  <div className="mt-6"><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Opportunity discovery</p><h1 className="mt-2 text-3xl font-black">Job search</h1><p className="mt-2 text-sm text-slate-500">Discover opportunities from a connected licensed job feed and save them to your tracker.</p></div>
  {error&&<div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
  <form onSubmit={search} className="card mt-6 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-xs font-bold text-slate-600 sm:col-span-2">Role, skills, or keywords<input required minLength={2} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder="e.g. frontend engineer, data analyst" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label className="text-xs font-bold text-slate-600">Location<input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" placeholder="Lagos, remote…" value={location} onChange={e=>setLocation(e.target.value)}/></label>
   <label className="text-xs font-bold text-slate-600">Employment type<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={employmentType} onChange={e=>setEmploymentType(e.target.value)}><option value="">Any type</option><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option><option>Remote</option></select></label>
   <label className="text-xs font-bold text-slate-600 sm:col-span-2">Workspace<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
   <div className="flex items-end"><button disabled={busy||!workspaceId} className="btn w-full"><Search size={15}/>{busy?"Searching…":"Search jobs"}</button></div>
  </form>
  {usage&&<p className="mt-3 text-xs text-slate-400">Job searches this month: {usage.used} / {usage.quota}</p>}
  {jobs.length>0&&<div className="mt-6 grid gap-4 md:grid-cols-2">{jobs.map((job,i)=><article key={job.source_url+i} className="card p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><BriefcaseBusiness size={19}/></span><div className="min-w-0 flex-1"><h2 className="font-extrabold">{job.title}</h2><p className="mt-1 text-sm text-slate-600">{job.company||"Company not supplied"}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><MapPin size={12}/>{job.location||"Location not supplied"}{job.employment_type?" · "+job.employment_type:""}</p></div><a href={job.source_url} target="_blank" rel="noreferrer" aria-label="Open job listing" className="text-violet-700"><ExternalLink size={16}/></a></div>
   <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">{job.description||"No description supplied by the source."}</p>
   <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-400">Source: {job.source}</span><button disabled={saved[job.source_url]} onClick={()=>save(job)} className="btn"><BookmarkPlus size={14}/>{saved[job.source_url]?"Saved":"Save job"}</button></div>
  </article>)}</div>}
  <p className="mt-5 text-xs leading-5 text-slate-400">Search activates only after a licensed job provider is configured. Listings are returned from that provider and are not fabricated. Verify terms and application URLs at the source before applying.</p>
 </div></main>;
}
