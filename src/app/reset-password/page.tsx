"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [complete,setComplete]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setError("");setComplete(false);
    if(password.length<10){setError("Use at least 10 characters for your new password.");return;}
    if(password!==confirm){setError("The passwords do not match.");return;}
    setBusy(true);
    const supabase=createClient();
    if(!supabase){setError("Supabase is not configured.");setBusy(false);return;}
    const {data:{user},error:sessionError}=await supabase.auth.getUser();
    if(sessionError||!user){setError("This recovery link is invalid or expired. Request a new password reset link.");setBusy(false);return;}
    const {error:updateError}=await supabase.auth.updateUser({password});
    if(updateError)setError(updateError.message);else{setComplete(true);setPassword("");setConfirm("");}
    setBusy(false);
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-10"><section className="card w-full max-w-md p-7 sm:p-9">
    <Link href="/login" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500"><ArrowLeft size={14}/> Back to login</Link>
    <span className="mt-7 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><LockKeyhole size={21}/></span>
    <h1 className="mt-5 text-2xl font-black">Choose a new password</h1>
    <p className="mt-2 text-sm leading-6 text-slate-500">Use at least 10 characters. This page requires a valid password recovery session.</p>
    {error&&<div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {complete&&<div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Your password has been updated. You can now sign in with the new password.</div>}
    <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-bold text-slate-600">New password<input type="password" required minLength={10} autoComplete="new-password" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="block text-xs font-bold text-slate-600">Confirm new password<input type="password" required minLength={10} autoComplete="new-password" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button disabled={busy} className="btn w-full">{busy?"Updating…":"Update password"}</button></form>
  </section></main>;
}
