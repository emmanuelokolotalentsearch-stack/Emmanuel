import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function context(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ error: "Workspace access denied." }, { status: 403 }) } as const;
  return { supabase, user, role: member.role } as const;
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  const { data: campaigns, error } = await ctx.supabase.from("outreach_campaigns").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const ids = (campaigns || []).map(c => c.id);
  const { data: recipients } = ids.length ? await ctx.supabase.from("outreach_campaign_recipients").select("campaign_id,status").in("campaign_id", ids) : { data: [] as any[] };
  const counts: Record<string, Record<string, number>> = {};
  for (const row of recipients || []) { counts[row.campaign_id] ||= {}; counts[row.campaign_id][row.status] = (counts[row.campaign_id][row.status] || 0) + 1; }
  return NextResponse.json({ campaigns: (campaigns || []).map(c => ({ ...c, counts: counts[c.id] || {} })) });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner","admin","member"].includes(ctx.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });
  const name = typeof body.name === "string" ? body.name.trim().slice(0,160) : "";
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0,300) : "";
  const content = typeof body.body === "string" ? body.body.trim().slice(0,10000) : "";
  if (!name || !subject || !content) return NextResponse.json({ error: "Campaign name, subject, and body are required." }, { status: 400 });

  if (body.action === "draft") {
    const { data, error } = await ctx.supabase.from("outreach_campaigns").insert({
      workspace_id: workspaceId, created_by: ctx.user.id, name, subject, body: content, status: "draft"
    }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ campaign: data }, { status: 201 });
  }
  if (body.action === "schedule") {
    if (!Array.isArray(body.contact_ids) || body.contact_ids.length < 1 || body.contact_ids.length > 500) return NextResponse.json({ error: "Select 1 to 500 contacts." }, { status: 400 });
    const runAt = typeof body.scheduled_for === "string" ? new Date(body.scheduled_for) : new Date();
    if (Number.isNaN(runAt.getTime())) return NextResponse.json({ error: "Invalid scheduled time." }, { status: 400 });
    const { data, error } = await ctx.supabase.rpc("schedule_outreach_campaign", {
      target_workspace: workspaceId, campaign_name: name, email_subject: subject, message_body: content,
      contact_ids: body.contact_ids, run_at: runAt.toISOString()
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ campaign_id: result?.campaign_id, recipient_count: result?.recipient_count }, { status: 201 });
  }
  return NextResponse.json({ error: "Choose draft or schedule." }, { status: 400 });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner","admin"].includes(ctx.role)) return NextResponse.json({ error: "Only workspace administrators can pause or cancel campaigns." }, { status: 403 });
  if (typeof body.id !== "string" || !["paused","cancelled","scheduled"].includes(body.status)) return NextResponse.json({ error: "Campaign id and paused/cancelled/scheduled status are required." }, { status: 400 });
  const patch: Record<string, unknown> = { status: body.status, updated_at: new Date().toISOString() };
  if (body.status === "scheduled") patch.scheduled_for = new Date().toISOString();
  const { data, error } = await ctx.supabase.from("outreach_campaigns").update(patch).eq("id", body.id).eq("workspace_id", workspaceId).in("status", ["draft","scheduled","sending","paused"]).select("id,status").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ campaign: data });
}
