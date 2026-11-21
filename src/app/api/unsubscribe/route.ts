import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

function page(message: string, success: boolean) {
  const color = success ? "#166534" : "#991b1b";
  return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:Arial,sans-serif;background:#f7f8fc;padding:40px 16px;color:#17233b"><main style="max-width:520px;margin:8vh auto;background:#fff;padding:32px;border-radius:16px"><h1 style="font-size:22px">Email preferences</h1><p style="color:${color};line-height:1.6">${message}</p><p style="font-size:12px;color:#64748b">AI Workforce Search</p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!verifyUnsubscribeToken(token)) return page("This unsubscribe link is invalid or has expired.", false);
  return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font-family:Arial,sans-serif;background:#f7f8fc;padding:40px 16px;color:#17233b"><main style="max-width:520px;margin:8vh auto;background:#fff;padding:32px;border-radius:16px"><h1 style="font-size:22px">Unsubscribe from email</h1><p style="line-height:1.6;color:#64748b">Confirm that you no longer want to receive marketing emails from this workspace.</p><form method="post" action="/api/unsubscribe"><input type="hidden" name="token" value="${token}"><button style="margin-top:20px;background:#6258e8;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:bold">Confirm unsubscribe</button></form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let token = "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({})); token = typeof body.token === "string" ? body.token : "";
  } else {
    const form = await request.formData().catch(() => null); token = String(form?.get("token") || "");
  }
  const value = verifyUnsubscribeToken(token);
  if (!value) return page("This unsubscribe link is invalid or has expired.", false);
  const admin = createAdminClient();
  if (!admin) return page("The preference service is temporarily unavailable. Please contact the sender to be removed.", false);
  const { error } = await admin.from("contacts").update({ email_opt_in: false, email_unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", value.contactId).eq("workspace_id", value.workspaceId);
  if (error) return page("We could not update your preference. Please contact the sender.", false);
  return page("You have been unsubscribed. No further marketing emails will be sent to this address by this workspace.", true);
}
