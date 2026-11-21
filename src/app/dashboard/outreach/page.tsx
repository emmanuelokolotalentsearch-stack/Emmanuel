"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Save, Send, Sparkles, FileText, RefreshCw } from "lucide-react";

type Workspace = { id: string; name: string };
type Contact = { id: string; full_name: string; email: string | null; company: string | null; job_title: string | null; email_opt_in: boolean; email_unsubscribed_at: string | null };
type Template = { id: string; name: string; subject: string; body: string };
type Message = { id: string; recipient_email: string; subject: string; body: string; status: string; created_at: string; error: string | null };

export default function OutreachPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const [cr, or] = await Promise.all([fetch("/api/contacts?workspace_id="+encodeURIComponent(id)),fetch("/api/outreach?workspace_id="+encodeURIComponent(id))]);
    const [cd, od] = await Promise.all([cr.json(),or.json()]);
    if (!cr.ok) throw new Error(cd.error || "Could not load contacts.");
    if (!or.ok) throw new Error(od.error || "Could not load outreach.");
    setContacts(cd.contacts || []); setTemplates(od.templates || []); setMessages(od.messages || []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/workspaces"), d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load workspaces.");
        if (!active) return;
        setWorkspaces(d.workspaces || []);
        const id = d.workspaces?.[0]?.id || "";
        setWorkspaceId(id); if (id) await load(id);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Unable to load outreach."); }
    })();
    return () => { active = false; };
  }, [load]);

  const activeContact = contacts.find(c => c.id === contactId);
  async function submit(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, action, ...extra }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Outreach action failed.");
      await load(workspaceId); return d;
    } catch (e) { setError(e instanceof Error ? e.message : "Outreach action failed."); return null; }
    finally { setBusy(false); }
  }

  async function generateDraft() {
    if (!activeContact) { setError("Choose a contact first."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        workspace_id: workspaceId, task: "outreach_draft",
        input: "Write a professional first-contact message to this person. Explain the business purpose in a clear, respectful way. Do not claim prior contact or shared experience. Return the first line as 'Subject: ...' followed by the message body. The sender will review before sending.",
        context: JSON.stringify({ contact: { name: activeContact.full_name, company: activeContact.company, role: activeContact.job_title }, purpose: body || "Introduce a relevant professional opportunity or service. Ask permission for a follow-up." })
      })});
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "AI drafting failed.");
      const text = String(d.output || "");
      const match = text.match(/^Subject:\s*(.+)\r?\n+/i);
      if (match) { setSubject(match[1].trim()); setBody(text.slice(match[0].length).trim()); }
      else setBody(text);
    } catch (e) { setError(e instanceof Error ? e.message : "AI drafting failed."); }
    finally { setBusy(false); }
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!activeContact?.email) { setError("Choose a contact with an email address."); return; }
    await submit("draft", { contact_id: contactId, subject, body });
    setSubject(""); setBody("");
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!templateName.trim() || !body.trim()) { setError("Enter a template name and message body."); return; }
    const result = await submit("template", { name: templateName, subject, body });
    if (result) setTemplateName("");
  }

  async function send(message: Message) {
    if (!window.confirm("Send this message to " + message.recipient_email + "?")) return;
    await submit("send", { message_id: message.id });
  }

  return <main className="min-h-screen px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={16}/> Dashboard</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Professional communication</p><h1 className="mt-2 text-3xl font-black">Outreach studio</h1><p className="mt-2 text-sm text-slate-500">Create reusable templates, draft messages, and send only to contacts with recorded consent.</p></div>
      {workspaces.length>0 && <select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);load(e.target.value).catch(err=>setError(err.message));}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}
    </div>
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {!workspaceId ? <div className="card mt-7 p-10 text-sm text-slate-500">Create a workspace first. <Link className="font-bold text-violet-700" href="/dashboard/contacts">Open CRM</Link>.</div> : <>
      <section className="card mt-6 p-5 sm:p-6"><h2 className="flex items-center gap-2 font-extrabold"><Mail size={18} className="text-violet-700"/> Compose a message</h2>
        <form onSubmit={saveDraft} className="mt-4 space-y-4">
          <label className="block text-xs font-bold text-slate-600">CRM contact<select required className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal" value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">Choose a contact</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.full_name}{c.email ? " · "+c.email : " · no email"}</option>)}</select></label>
          {activeContact && <p className={"rounded-lg p-3 text-xs "+(activeContact.email_opt_in&&!activeContact.email_unsubscribed_at?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900")}>{activeContact.email_opt_in&&!activeContact.email_unsubscribed_at?"Marketing email consent is recorded.":"This contact is not eligible for marketing email sending. You may save a draft, but sending will be blocked."}</p>}
          {templates.length>0 && <label className="block text-xs font-bold text-slate-600">Use a saved template<select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal" value="" onChange={e=>{const t=templates.find(x=>x.id===e.target.value);if(t){setSubject(t.subject);setBody(t.body);}}}><option value="">Select template…</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
          <label className="block text-xs font-bold text-slate-600">Subject<input required maxLength={300} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={subject} onChange={e=>setSubject(e.target.value)}/></label>
          <label className="block text-xs font-bold text-slate-600">Message body<textarea required maxLength={10000} rows={7} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={body} onChange={e=>setBody(e.target.value)} placeholder="Write a respectful, relevant message for human review…"/></label>
          <div className="flex flex-wrap justify-between gap-3"><button type="button" disabled={busy||!contactId} onClick={generateDraft} className="btn-outline"><Sparkles size={15}/> Draft with AI</button><button disabled={busy||!contactId||!subject.trim()||!body.trim()} className="btn"><Save size={15}/> Save draft</button></div>
        </form>
      </section>

      <section className="card mt-5 p-5"><h2 className="flex items-center gap-2 font-extrabold"><FileText size={17}/> Reusable templates</h2>
        <form onSubmit={saveTemplate} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><input required className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Template name" value={templateName} onChange={e=>setTemplateName(e.target.value)}/><input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Uses subject above" value={subject} onChange={e=>setSubject(e.target.value)}/><button disabled={busy||!templateName.trim()||!body.trim()} className="btn"><Save size={14}/> Save template</button></form>
        {templates.length>0 && <div className="mt-4 flex flex-wrap gap-2">{templates.map(t=><button key={t.id} onClick={()=>{setSubject(t.subject);setBody(t.body);}} className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700">{t.name}</button>)}</div>}
      </section>

      <section className="card mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-extrabold">Message history</h2><p className="mt-1 text-xs text-slate-400">{messages.length} draft(s) and sent messages</p></div><button className="btn-outline" onClick={()=>load(workspaceId).catch(e=>setError(e.message))}><RefreshCw size={14}/> Refresh</button></div>
        {messages.length ? <div className="divide-y divide-slate-100">{messages.map(m=><div key={m.id} className="flex flex-wrap items-center gap-3 p-4"><span className="flex-1 min-w-0"><span className="block truncate text-sm font-bold">{m.subject}</span><span className="mt-1 block text-xs text-slate-400">{m.recipient_email} · {new Date(m.created_at).toLocaleString()}</span>{m.error&&<span className="mt-1 block text-xs text-red-600">{m.error}</span>}</span><span className={"rounded-full px-3 py-1 text-[11px] font-bold capitalize "+(m.status==="sent"?"bg-emerald-50 text-emerald-700":m.status==="failed"?"bg-red-50 text-red-700":"bg-amber-50 text-amber-700")}>{m.status}</span>{(m.status==="draft"||m.status==="failed")&&<button disabled={busy} onClick={()=>send(m)} className="btn"><Send size={14}/>{m.status==="failed"?"Retry send":"Send"}</button>}</div>)}</div> : <div className="p-12 text-center text-sm text-slate-500">Your saved drafts and delivery history will appear here.</div>}
      </section>
    </>}
    <p className="mt-4 text-[11px] leading-5 text-slate-400">Sending requires a verified sender, Resend credentials, a signing secret, and recorded marketing consent. Unsubscribe links and one-click unsubscribe headers are added by the server.</p>
  </div></main>;
}
