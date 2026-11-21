"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Users, Building2, Contact, BriefcaseBusiness, CreditCard, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";

type Stats = { users:number;workspaces:number;memberships:number;contacts:number;jobs:number;subscriptions_active:number;subscriptions_past_due:number;plans:Record<string,number> };
type Tenant = { id:string; name:string; slug:string; created_at:string; member_count:number; subscription:{plan:string;status:string;current_period_end:string|null} };

export default function AdminPage(){
 const [stats,setStats]=useState<Stats|null>(null);const [tenants,setTenants]=useState<Tenant[]>([]);
 const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [query,setQuery]=useState("");const [appliedQuery,setAppliedQuery]=useState("");const [page,setPage]=useState(1);const [total,setTotal]=useState(0);
 const load=useCallback(async(nextPage:number,term:string)=>{
  setLoading(true);setError("");
  try{
   const [sr,tr]=await Promise.all([fetch("/api/admin/overview"),fetch("/api/admin/workspaces?page="+nextPage+"&q="+encodeURIComponent(term))]);
   const [sd,td]=await Promise.all([sr.json(),tr.json()]);
   if(!sr.ok)throw new Error(sd.error||"Could not load platform metrics.");
   if(!tr.ok)throw new Error(td.error||"Could not load workspace list.");
   setStats(sd.stats);setTenants(td.workspaces||[]);setTotal(td.total||0);setPage(nextPage);
  }catch(e){setError(e instanceof Error?e.message:"Admin dashboard unavailable.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{load(1,"");},[load]);
 const metrics=[["Registered users",stats?.users,Users],["Workspaces",stats?.workspaces,Building2],["Workspace memberships",stats?.memberships,Users],["Saved contacts",stats?.contacts,Contact],["Saved jobs",stats?.jobs,BriefcaseBusiness],["Active subscriptions",stats?.subscriptions_active,CreditCard],["Past-due subscriptions",stats?.subscriptions_past_due,CreditCard]] as const;
 function search(e:FormEvent){e.preventDefault();setAppliedQuery(query.trim());load(1,query.trim());}
 return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-7xl">
  <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
  <div className="mt-6 flex items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Platform operations</p><h1 className="mt-2 text-3xl font-black">Super admin</h1><p className="mt-2 text-sm text-slate-500">Global metrics and workspace-level operational status.</p></div><button onClick={()=>load(page,appliedQuery)} className="btn-outline"><RefreshCw size={14}/> Refresh</button></div>
  {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  {loading?<div className="card mt-7 p-10 text-center text-sm text-slate-500">Loading platform data…</div>:stats&&<>
   <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label,value,Icon])=><section key={label} className="card p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Icon size={18}/></span></div><p className="mt-4 text-3xl font-black">{value?.toLocaleString()??"—"}</p></section>)}</div>
   <section className="card mt-5 p-6"><h2 className="font-extrabold">Subscription plans</h2><div className="mt-3 flex flex-wrap gap-3">{Object.entries(stats.plans||{}).map(([plan,count])=><span key={plan} className="rounded-xl bg-slate-50 px-4 py-3 text-sm capitalize"><b>{plan}</b><span className="ml-2 text-slate-500">{count}</span></span>)}</div></section>
   <section className="card mt-5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-extrabold">Workspaces</h2><p className="mt-1 text-xs text-slate-400">{total.toLocaleString()} workspace(s) · no contact records exposed</p></div><form onSubmit={search} className="flex gap-2"><input className="w-56 max-w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Search name or slug" value={query} onChange={e=>setQuery(e.target.value)}/><button className="btn-outline"><Search size={14}/> Search</button></form></div>
    {tenants.length?<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Workspace</th><th className="px-5 py-3">Members</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Subscription</th><th className="px-5 py-3">Created</th></tr></thead><tbody className="divide-y divide-slate-100">{tenants.map(t=><tr key={t.id}><td className="px-5 py-4"><p className="font-bold">{t.name}</p><p className="mt-1 text-xs text-slate-400">{t.slug}</p></td><td className="px-5 py-4">{t.member_count}</td><td className="px-5 py-4 capitalize">{t.subscription.plan}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold capitalize">{t.subscription.status}</span></td><td className="px-5 py-4 text-xs text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-slate-500">No workspaces match this search.</div>}
    <div className="flex items-center justify-between border-t border-slate-100 p-4"><p className="text-xs text-slate-400">Page {page} of {Math.max(1,Math.ceil(total/25))}</p><div className="flex gap-2"><button disabled={page<=1||loading} onClick={()=>load(page-1,appliedQuery)} className="btn-outline"><ChevronLeft size={14}/> Previous</button><button disabled={page>=Math.ceil(total/25)||loading} onClick={()=>load(page+1,appliedQuery)} className="btn-outline">Next <ChevronRight size={14}/></button></div></div>
   </section>
  </>}
  <div className="mt-5 flex gap-3 rounded-xl border border-slate-200 bg-white p-4"><ShieldCheck size={18} className="shrink-0 text-emerald-600"/><p className="text-xs leading-5 text-slate-500">Access is granted only to users explicitly added to public.platform_admins by the database administrator. This console exposes workspace metadata and aggregate metrics, not candidate or contact records.</p></div>
 </div></main>;
}
