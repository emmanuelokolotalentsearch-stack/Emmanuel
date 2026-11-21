"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Users, Building2, Contact, BriefcaseBusiness, CreditCard, RefreshCw } from "lucide-react";

type Stats = { users:number;workspaces:number;memberships:number;contacts:number;jobs:number;subscriptions_active:number;subscriptions_past_due:number;plans:Record<string,number> };

export default function AdminPage(){
 const [stats,setStats]=useState<Stats|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
 async function load(){setLoading(true);setError("");try{const r=await fetch("/api/admin/overview"),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load platform metrics.");setStats(d.stats);}catch(e){setError(e instanceof Error?e.message:"Admin dashboard unavailable.");}finally{setLoading(false);}}
 useEffect(()=>{load();},[]);
 const metrics=[["Registered users",stats?.users,Users],["Workspaces",stats?.workspaces,Building2],["Workspace memberships",stats?.memberships,Users],["Saved contacts",stats?.contacts,Contact],["Saved jobs",stats?.jobs,BriefcaseBusiness],["Active subscriptions",stats?.subscriptions_active,CreditCard],["Past-due subscriptions",stats?.subscriptions_past_due,CreditCard]] as const;
 return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl"><Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link><div className="mt-6 flex items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Platform operations</p><h1 className="mt-2 text-3xl font-black">Super admin</h1><p className="mt-2 text-sm text-slate-500">Global metrics from the platform database.</p></div><button onClick={load} className="btn-outline"><RefreshCw size={14}/> Refresh</button></div>
 {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
 {loading?<div className="card mt-7 p-10 text-center text-sm text-slate-500">Loading platform metrics…</div>:stats&&<><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label,value,Icon])=><section key={label} className="card p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Icon size={18}/></span></div><p className="mt-4 text-3xl font-black">{value?.toLocaleString()??"—"}</p></section>)}</div><section className="card mt-5 p-6"><h2 className="font-extrabold">Subscription plans</h2><div className="mt-3 flex flex-wrap gap-3">{Object.entries(stats.plans||{}).map(([plan,count])=><span key={plan} className="rounded-xl bg-slate-50 px-4 py-3 text-sm capitalize"><b>{plan}</b><span className="ml-2 text-slate-500">{count}</span></span>)}</div></section></>}
 <div className="mt-5 flex gap-3 rounded-xl border border-slate-200 bg-white p-4"><ShieldCheck size={18} className="shrink-0 text-emerald-600"/><p className="text-xs leading-5 text-slate-500">Access is granted only to users explicitly added to public.platform_admins by the database administrator. Metrics are aggregated; this screen does not expose customer contact records.</p></div></div></main>;
}
