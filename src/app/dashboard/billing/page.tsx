"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, ShieldCheck, ExternalLink, RefreshCw } from "lucide-react";

type Workspace = { id: string; name: string; role: string };
type Subscription = { plan: string; status: string; provider?: string; current_period_end?: string | null; cancel_at_period_end?: boolean };

const plans = [
  { id: "starter", title: "Starter", description: "For individuals and small teams getting started." },
  { id: "growth", title: "Growth", description: "For growing recruiting and prospecting teams." },
  { id: "business", title: "Business", description: "For teams with larger AI usage needs." }
];

export default function BillingPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [subscription, setSubscription] = useState<Subscription>({ plan: "free", status: "free" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadBilling(id: string) {
    const r = await fetch("/api/billing?workspace_id="+encodeURIComponent(id)), d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not load billing status.");
    setSubscription(d.subscription);
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/workspaces"), d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load workspaces.");
        const owners: Workspace[] = (d.workspaces || []).filter((w: Workspace) => w.role === "owner");
        setWorkspaces(owners);
        const id = owners[0]?.id || ""; setWorkspaceId(id);
        if (id) await loadBilling(id);
        const ref = new URLSearchParams(window.location.search).get("reference");
        if (ref) setNotice("Payment is being verified by the secure Paystack webhook. Your plan activates after confirmation.");
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load billing."); }
    })();
  }, []);

  async function manageSubscription() {\n    setBusy(true); setError("");\n    try {\n      const r = await fetch("/api/billing/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId }) });\n      const d = await r.json();\n      if (!r.ok) throw new Error(d.error || "Could not open subscription management.");\n      window.location.assign(d.url);\n    } catch (e) { setError(e instanceof Error ? e.message : "Could not manage subscription."); setBusy(false); }\n  }\n\n  async function checkout(plan: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, plan }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start checkout.");
      window.location.assign(d.authorization_url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start checkout."); setBusy(false); }
  }

  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-5xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6"><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Plan and payments</p><h1 className="mt-2 text-3xl font-black">Billing</h1><p className="mt-2 text-sm text-slate-500">Manage the subscription for a workspace you own.</p></div>
    {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {notice&&<div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    {!workspaces.length ? <div className="card mt-7 p-8 text-sm text-slate-600">Billing is available to workspace owners. <Link href="/dashboard/contacts" className="font-bold text-violet-700">Create a workspace</Link> or ask its owner to manage billing.</div> : <>
      <div className="card mt-7 flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-xs font-bold text-slate-400">Workspace</p><select value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);loadBilling(e.target.value).catch(err=>setError(err.message));}} className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></div><div className="text-right"><p className="text-xs font-bold text-slate-400">Current plan</p><p className="mt-1 text-lg font-black capitalize">{subscription.plan} <span className={"text-xs font-bold "+(subscription.status==="active"?"text-emerald-700":"text-amber-700")}>· {subscription.status}</span></p>{subscription.current_period_end&&<p className="mt-1 text-xs text-slate-400">Next billing date: {new Date(subscription.current_period_end).toLocaleDateString()}</p>}{subscription.cancel_at_period_end&&<p className="mt-1 text-xs text-amber-700">Cancellation scheduled at period end.</p>}</div>{subscription.provider==="paystack"&&["active","past_due"].includes(subscription.status)&&<button disabled={busy} onClick={manageSubscription} className="btn-outline"><ExternalLink size={14}/> Manage / cancel subscription</button>}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{plans.map(p=><section key={p.id} className="card p-6"><span className="rounded-xl bg-violet-50 p-3 text-violet-700 inline-flex"><CreditCard size={20}/></span><h2 className="mt-4 text-xl font-black">{p.title}</h2><p className="mt-2 min-h-10 text-sm leading-6 text-slate-500">{p.description}</p><button disabled={busy||subscription.plan===p.id&&subscription.status==="active"} onClick={()=>checkout(p.id)} className="btn mt-5 w-full justify-center">{busy?"Opening checkout…":subscription.plan===p.id&&subscription.status==="active"?"Current plan":"Choose "+p.title}</button></section>)}</div>
      <div className="mt-5 flex gap-3 rounded-xl border border-slate-200 bg-white p-4"><ShieldCheck size={19} className="shrink-0 text-emerald-600"/><p className="text-xs leading-5 text-slate-500">Payments are initiated on the server through Paystack. Plan activation is based on signed payment webhooks, not the browser redirect. Paystack hosts the subscription management page where owners can update payment details or cancel. Configure recurring monthly plan codes in Paystack before enabling checkout.</p></div>
    </>}
  </div></main>;
}
