import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUnsubscribeToken } from "@/lib/email/unsubscribe";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const received = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (secret.length < 32 || !received) return false;
  const a = Buffer.from(secret), b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a,b);
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]!)); }

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service-role key is not configured." }, { status: 503 });
  const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return NextResponse.json({ error: "Resend delivery is not configured." }, { status: 503 });
  try {
    const now = new Date().toISOString();
    const { data: campaigns, error } = await admin.from("outreach_campaigns").select("*")
      .in("status", ["scheduled","sending"]).lte("scheduled_for", now).order("scheduled_for").limit(10);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let sent = 0, failed = 0, skipped = 0, processed = 0, quotaBlocked = false;
    for (const campaign of campaigns || []) {
      if (campaign.status === "scheduled") {
        const claim = await admin.from("outreach_campaigns").update({ status: "sending", updated_at: now }).eq("id", campaign.id).eq("status", "scheduled").select("id").maybeSingle();
        if (!claim.data) continue;
      }
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const [queuedResult, staleResult] = await Promise.all([
        admin.from("outreach_campaign_recipients").select("id,contact_id,status").eq("campaign_id", campaign.id).eq("status", "queued").limit(25),
        admin.from("outreach_campaign_recipients").select("id,contact_id,status").eq("campaign_id", campaign.id).eq("status", "sending").lt("updated_at", staleBefore).limit(25)
      ]);
      if (queuedResult.error || staleResult.error) { failed++; continue; }
      const recipients = [...(queuedResult.data || []), ...(staleResult.data || [])].slice(0,25);
      for (const recipient of recipients) {
        const claim = await admin.from("outreach_campaign_recipients").update({ status: "sending", updated_at: new Date().toISOString() })
          .eq("id", recipient.id).eq("status", recipient.status).select("id").maybeSingle();
        if (!claim.data) continue;
        processed++;
        const { data: contact } = await admin.from("contacts").select("id,email,email_opt_in,email_unsubscribed_at").eq("id", recipient.contact_id).eq("workspace_id", campaign.workspace_id).maybeSingle();
        if (!contact?.email || !contact.email_opt_in || contact.email_unsubscribed_at) {
          await admin.from("outreach_campaign_recipients").update({ status: "skipped", error: "No current email consent or email address.", updated_at: new Date().toISOString() }).eq("id", recipient.id);
          skipped++; continue;
        }
        const { data: quotaData, error: quotaError } = await admin.rpc("consume_service_feature_usage", {
          target_workspace: campaign.workspace_id, target_actor: campaign.created_by, feature_name: "campaign_send", usage_units: 1
        });
        if (quotaError) {
          await admin.from("outreach_campaign_recipients").update({ status: "queued", error: "Usage guard unavailable; retry after migration 0009 is applied.", updated_at: new Date().toISOString() }).eq("id", recipient.id);
          throw new Error("Scheduled email quota check failed: " + quotaError.message);
        }
        const quota = Array.isArray(quotaData) ? quotaData[0] : quotaData;
        if (!quota?.allowed) {
          await admin.from("outreach_campaign_recipients").update({ status: "queued", error: "Monthly campaign-send quota reached.", updated_at: new Date().toISOString() }).eq("id", recipient.id);
          await admin.from("outreach_campaigns").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", campaign.id);
          quotaBlocked = true; skipped++; break;
        }
        let token: string;
        try { token = createUnsubscribeToken(campaign.workspace_id, contact.id); }
        catch (e) {
          await admin.from("outreach_campaign_recipients").update({ status: "failed", error: e instanceof Error ? e.message : "Unsubscribe configuration missing.", updated_at: new Date().toISOString() }).eq("id", recipient.id);
          failed++; continue;
        }
        const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
        const unsubscribeUrl = base.replace(/\/$/,"") + "/api/unsubscribe?token=" + encodeURIComponent(token);
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST", signal: AbortSignal.timeout(25000),
            headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "Idempotency-Key": "campaign-recipient-" + recipient.id },
            body: JSON.stringify({
              from, to: [contact.email], subject: campaign.subject,
              text: campaign.body + "\n\nTo stop receiving these emails, unsubscribe here: " + unsubscribeUrl,
              html: "<div style=\"font-family:Arial,sans-serif;white-space:pre-wrap\">" + escapeHtml(campaign.body) + "</div><p><a href=\"" + escapeHtml(unsubscribeUrl) + "\">Unsubscribe</a></p>",
              headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            })
          });
          const result = await response.json().catch(() => ({}));
          const at = new Date().toISOString();
          if (!response.ok) {
            await admin.from("outreach_campaign_recipients").update({ status: "failed", error: result?.message || "Provider rejected email.", updated_at: at }).eq("id", recipient.id);
            await admin.from("outreach_messages").insert({ workspace_id: campaign.workspace_id, contact_id: contact.id, created_by: campaign.created_by, recipient_email: contact.email, subject: campaign.subject, body: campaign.body, status: "failed", error: result?.message || "Provider rejected email." });
            failed++;
          } else {
            await admin.from("outreach_campaign_recipients").update({ status: "sent", provider_id: result.id || null, sent_at: at, updated_at: at }).eq("id", recipient.id);
            await Promise.all([
              admin.from("contacts").update({ last_contacted_at: at, updated_at: at }).eq("id", contact.id),
              admin.from("outreach_messages").insert({ workspace_id: campaign.workspace_id, contact_id: contact.id, created_by: campaign.created_by, recipient_email: contact.email, subject: campaign.subject, body: campaign.body, status: "sent", provider_id: result.id || null, sent_at: at }),
              admin.from("activities").insert({ workspace_id: campaign.workspace_id, actor_id: campaign.created_by, contact_id: contact.id, kind: "email_draft", summary: "Scheduled campaign sent to " + contact.email + "." })
            ]);
            sent++;
          }
        } catch (e) {
          await admin.from("outreach_campaign_recipients").update({ status: "failed", error: e instanceof Error ? e.message : "Delivery request failed.", updated_at: new Date().toISOString() }).eq("id", recipient.id);
          failed++;
        }
      }
      if (quotaBlocked) break;
      const { count } = await admin.from("outreach_campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).in("status", ["queued","sending"]);
      if (!count) await admin.from("outreach_campaigns").update({ status: "sent", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaign.id).eq("status", "sending");
    }
    return NextResponse.json({ processed, sent, failed, skipped, quota_blocked: quotaBlocked, campaigns_checked: campaigns?.length || 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scheduled delivery failed." }, { status: 500 });
  }
}
