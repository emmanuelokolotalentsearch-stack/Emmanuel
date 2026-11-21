"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, RefreshCw, Sparkles, Search, AtSign, Mail, ShieldCheck } from "lucide-react";

type Workspace={id:string;name:string;role:string};
type Feature={feature:string;used:number;quota:number;remaining:number};
type Usage={plan:string;month_start:string;features:Feature[]};

const labels:Record<string,{label:string;description:string;icon:any}> = {
 people_search:{label:"People search",description:"Licensed professional search requests",icon:Search},
 email_find:{label:"Email finder",description:"Business email discovery requests",icon:AtSign},
 email_verify:{label:"Email verification",description:"Email verification lookups",icon:ShieldCheck},
 ai_assistant:{label:"AI assistant",description:"General assistant prompts",icon:Sparkles},
 ai_profile_analysis:{label:"Profile analysis",description:"Professional profile assessments",icon:Sparkles},
 ai_outreach_draft:{label:"AI outreach drafts",description:"AI-generated outreach drafts",icon:Sparkles},
 ai_job_match:{label:"AI job matching",description:"Evidence-based job fit analysis",icon:Sparkles},
 email_send:{label:"Email sends",description:"Direct and scheduled campaign sends combined",icon:Mail}
};

export default function UsagePage(){
 const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
 const [workspaceId,setWorkspaceId]=useState("");
 const [usage,setUsage]=useState<Usage|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");

 const loadUsage=useCallback(async(id:string)=>{
  if(!id){setUsage(null);return;}
  const r=await fetch("/api/usage?workspace_id="+encodeURIComponent(id));
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||"Could not load usage.");
  setUsage(d);
 },[]);

 useEffect(()=>{
  let active=true;
  (async()=>{
   try{
    const r=await fetch("/api/workspaces"),d=await r.json();
    if(!r.ok)throw new Error(d.error||"Could not load workspaces.");
    if(!active)return;
    const list:Workspace[]=d.workspaces||[];
    setWorkspaces(list);
    const id=list[0]?.id||"";
    setWorkspaceId(id);
    if(id)await loadUsage(id);
   }catch(e){if(active)setError(e instanceof Error?e.message:"Usage unavailable.");}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[loadUsage]);

 const month=usage?.month_start?new Date(usage.month_start+"T00:00:00").toLocaleDateString(undefined,{month:"long",year:"numeric"}):"Current month";
 return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
  <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
  <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
   <div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Plan and consumption</p><h1 className="mt-2 text-3xl font-black">Usage & limits</h1><p className="mt-2 text-sm text-slate-500">Monthly usage for the selected workspace.</p></div>
   {workspaces.length>0&&<select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);loadUsage(e.target.value).catch(err=>setError(err.message));}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}
  </div>
  {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  {loading?<div className="card mt-7 p-10 text-center text-sm text-slate-500">Loading usage…</div>:!workspaceId?<div className="card mt-7 p-10 text-center text-sm text-slate-500">Create or join a workspace to see usage.</div>:usage&&<>
   <section className="card mt-7 flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-xs font-bold text-slate-400">Current plan</p><p className="mt-1 text-xl font-black capitalize">{usage.plan}</p></div><div><p className="text-xs font-bold text-slate-400">Usage period</p><p className="mt-1 text-sm font-bold">{month}</p></div><div className="flex gap-2"><Link className="btn-outline" href="/dashboard/billing">Manage plan</Link><button className="btn-outline" onClick={()=>loadUsage(workspaceId).catch(e=>setError(e.message))}><RefreshCw size={14}/> Refresh</button></div></section>
   <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{usage.features.map(item=>{
    const meta=labels[item.feature]||{label:item.feature,description:"Monthly feature usage",icon:Activity};
    const Icon=meta.icon;const percent=item.quota?Math.min(100,item.used/item.quota*100):0;
    return <article key={item.feature} className="card p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><Icon size={18}/></span><div className="min-w-0 flex-1"><h2 className="text-sm font-extrabold">{meta.label}</h2><p className="mt-1 text-[11px] text-slate-400">{meta.description}</p></div></div>
     <div className="mt-5 flex items-baseline justify-between"><p className="text-2xl font-black">{item.used.toLocaleString()} <span className="text-xs font-semibold text-slate-400">/ {item.quota.toLocaleString()}</span></p><span className="text-[11px] font-bold text-emerald-700">{item.remaining.toLocaleString()} left</span></div>
     <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600" style={{width:percent+"%"}}/></div>
    </article>;
   })}</div>
  </>}
  <p className="mt-5 text-xs leading-5 text-slate-400">Limits are per workspace and feature, and reset monthly. Direct email and scheduled campaign sends share one email quota. Usage is counted server-side; an inactive, cancelled, or past-due subscription uses Free limits.</p>
 </div></main>;
}
