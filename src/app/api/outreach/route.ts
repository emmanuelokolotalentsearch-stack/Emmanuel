import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUnsubscribeToken } from "@/lib/email/unsubscribe";

async function context(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return { error: NextResponse.json({ error: "Invalid workspace_id." }, { status: 400 }) } as const;
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin", "member"].includes(member.role)) return { error: NextResponse.json({ error: "Workspace editor access required." }, { status: 403 }) } as const;
  return { supabase, user, role: member.role } as const;
}
function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, ch => entities[ch] || ch);
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  const [templates, messages] = await Promise.all([
    ctx.supabase.from("outreach_templates").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    ctx.supabase.from("outreach_messages").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100)
  ]);
  if (templates.error || messages.error) return NextResponse.json({ error: templates.error?.message || messages.error?.message }, { status: 400 });
  return NextResponse.json({ templates: templates.data || [], messages: messages.data || [] });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;

  if (body.action === "template") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
    const content = typeof body.body === "string" ? body.body.trim().slice(0, 10000) : "";
    if (!name || !content) return NextResponse.json({ error: "Template name and message body are required." }, { status: 400 });
    const { data, error } = await ctx.supabase.from("outreach_templates").insert({ workspace_id: workspaceId, created_by: ctx.user.id, name, subject, body: content }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ template: data }, { status: 201 });
  }

  if (body.action === "draft") {
    if (typeof body.contact_id !== "string") return NextResponse.json({ error: "Select a CRM contact for this draft." }, { status: 400 });
    const { data: contact, error: contactError } = await ctx.supabase.from("contacts").select("id,email").eq("id", body.contact_id).eq("workspace_id", workspaceId).single();
    if (contactError || !contact?.email) return NextResponse.json({ error: "Contact not found or has no email address." }, { status: 404 });
    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
    const content = typeof body.body === "string" ? body.body.trim().slice(0, 10000) : "";
    if (!subject || !content) return NextResponse.json({ error: "Subject and message body are required." }, { status: 400 });
    const { data, error } = await ctx.supabase.from("outreach_messages").insert({
      workspace_id: workspaceId, contact_id: contact.id, created_by: ctx.user.id,
      recipient_email: contact.email, subject, body: content, status: "draft"
    }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ message: data }, { status: 201 });
  }

  if (body.action === "send") {
    if (typeof body.message_id !== "string") return NextResponse.json({ error: "message_id is required." }, { status: 400 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Secure sending requires SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
    const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
    if (!apiKey || !from) return NextResponse.json({ error: "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM on the server." }, { status: 503 });
    const { data: draft, error: draftError } = await admin.from("outreach_messages").select("*").eq("id", body.message_id).eq("workspace_id", workspaceId).maybeSingle();
    if (draftError) return NextResponse.json({ error: draftError.message }, { status: 400 });
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    const previousStatus = draft.status;
    if (!["draft", "failed", "sending"].includes(previousStatus)) return NextResponse.json({ error: "This message has already been sent or cannot be retried." }, { status: 409 });
    if (previousStatus === "sending" && new Date(draft.updated_at || 0).getTime() > Date.now() - 15 * 60 * 1000) {
      return NextResponse.json({ error: "This message is already being sent. Try again after the send lock expires." }, { status: 409 });
    }
    if (!draft.contact_id) return NextResponse.json({ error: "Draft is not linked to a CRM contact." }, { status: 400 });
    const { data: contact } = await admin.from("contacts").select("id,email,email_opt_in,email_opt_in_at,email_consent_source,email_consent_note,email_unsubscribed_at").eq("id", draft.contact_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!contact || contact.email !== draft.recipient_email) return NextResponse.json({ error: "Contact email changed. Review and create a fresh draft." }, { status: 409 });
    if (!contact.email_opt_in || !contact.email_opt_in_at || !contact.email_consent_source || String(contact.email_consent_note || "").trim().length < 10 || contact.email_unsubscribed_at) return NextResponse.json({ error: "This contact has no complete current marketing consent evidence or has unsubscribed. Sending is blocked." }, { status: 403 });
    let unsubscribeToken: string;
    try { unsubscribeToken = createUnsubscribeToken(workspaceId, contact.id); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Unsubscribe signing is not configured." }, { status: 503 }); }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const unsubscribeUrl = appUrl.replace(/\/$/, "") + "/api/unsubscribe?token=" + encodeURIComponent(unsubscribeToken);
    let claimQuery = admin.from("outreach_messages").update({ status: "sending", error: null, updated_at: new Date().toISOString() })
      .eq("id", draft.id).eq("workspace_id", workspaceId).eq("status", previousStatus);
    if (previousStatus === "sending") claimQuery = claimQuery.lt("updated_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    const claim = await claimQuery.select("id").maybeSingle();
    if (claim.error || !claim.data) return NextResponse.json({ error: "This message is already being sent or has changed." }, { status: 409 });

    const { data: quotaData, error: quotaError } = await admin.rpc("consume_service_feature_usage", {
      target_workspace: workspaceId, target_actor: ctx.user.id,
      feature_name: "email_send", usage_units: 1, request_key: "outreach-message:" + draft.id
    });
    const quota = Array.isArray(quotaData) ? quotaData[0] : quotaData;
    if (quotaError || !quota?.allowed) {
      await admin.from("outreach_messages").update({
        status: previousStatus === "sending" ? "failed" : previousStatus,
        error: quotaError ? "Email usage guard unavailable." : "Monthly email-send limit reached.",
        updated_at: new Date().toISOString()
      }).eq("id", draft.id).eq("status", "sending");
      if (quotaError) return NextResponse.json({ error: "Email usage guard unavailable. Apply migration 0011_month_scoped_email_usage.sql.", detail: quotaError.message }, { status: 503 });
      return NextResponse.json({ error: "This workspace has reached its monthly email-send limit.", used: quota?.used, quota: quota?.quota }, { status: 429 });
    }

    const bodyText = draft.body + "\n\nTo stop receiving these emails, unsubscribe here: " + unsubscribeUrl;
    try {
      const resend = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "Idempotency-Key": "outreach-message-" + draft.id },
        body: JSON.stringify({
          from, to: [draft.recipient_email], subject: draft.subject, text: bodyText,
          html: "<div style=\\"font-family:Arial,sans-serif;white-space:pre-wrap\\">" + escapeHtml(draft.body) + "</div><p style=\\"font-size:12px;color:#666\\"><a href=\\"" + escapeHtml(unsubscribeUrl) + "\\">Unsubscribe</a></p>",
          headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        }),
        signal: AbortSignal.timeout(30000)
      });
      const result = await resend.json().catch(() => ({}));
      if (!resend.ok) {
        await admin.from("outreach_messages").update({ status: "failed", error: result?.message || "Email provider rejected the message.", updated_at: new Date().toISOString() }).eq("id", draft.id);
        return NextResponse.json({ error: result?.message || "Email provider rejected the message." }, { status: 502 });
      }
      const sentAt = new Date().toISOString();
      await Promise.all([
        admin.from("outreach_messages").update({ status: "sent", provider_id: result.id || null, sent_at: sentAt, error: null, updated_at: sentAt }).eq("id", draft.id),
        admin.from("contacts").update({ last_contacted_at: sentAt, updated_at: sentAt }).eq("id", contact.id)
      ]);
      return NextResponse.json({ sent: true, provider_id: result.id || null, usage: { used: quota.used, quota: quota.quota } });
    } catch (error) {
      await admin.from("outreach_messages").update({ status: "failed", error: error instanceof Error ? error.message : "Email delivery request failed.", updated_at: new Date().toISOString() }).eq("id", draft.id);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Email delivery request failed." }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Unsupported outreach action." }, { status: 400 });
}
