"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email,setEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [sent,setSent]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setBusy(true);setError("");setSent(false);
    const supabase=createClient();
    if(!supabase){setError("Supabase is not configured. Ask the administrator to complete authentication setup.");setBusy(false);return;}
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin+"/reset-password"});
    if(error)setError(error.message);else setSent(true);
    setBusy(false);
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-10"><section className="card w-full max-w-md p-7 sm:p-9">
    <Link href="/login" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500"><ArrowLeft size={14}/> Back to login</Link>
    <span className="mt-7 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Mail size={21}/></span>
    <h1 className="mt-5 text-2xl font-black">Reset your password</h1>
    <p className="mt-2 text-sm leading-6 text-slate-500">Enter the email address associated with your account. We’ll send a secure recovery link if the account is eligible.</p>
    {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {sent&&<div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.</div>}
    <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-bold text-slate-600">Email address<input type="email" required autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy} className="btn w-full">{busy?"Sending…":"Send reset link"}</button></form>
  </section></main>;
}
