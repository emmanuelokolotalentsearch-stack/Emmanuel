import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return NextResponse.json({ error: "A valid workspace_id is required." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role,workspaces(name,slug)").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });

  const tables = ["contacts","activities","jobs","applications","outreach_templates","outreach_messages","outreach_campaigns","outreach_campaign_recipients","usage_events","workspace_settings"] as const;
  const exported: Record<string, unknown> = {};
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").eq("workspace_id",workspaceId).limit(10000);
    if (error) return NextResponse.json({ error: "Export failed for " + table + ": " + error.message }, { status: 500 });
    exported[table] = data || [];
  }
  if (["owner","admin"].includes(member.role)) {
    const { data, error } = await supabase.from("subscriptions").select("plan,status,provider,customer_email,current_period_end,cancel_at_period_end,updated_at").eq("workspace_id",workspaceId).maybeSingle();
    if (error) return NextResponse.json({ error: "Subscription export failed: " + error.message }, { status: 500 });
    exported.subscriptions = data ? [data] : [];
  }
  const workspace = Array.isArray(member.workspaces) ? member.workspaces[0] : member.workspaces;
  const payload = { exported_at: new Date().toISOString(), workspace: workspace || { id: workspaceId }, exported_by: user.email, data: exported };
  const filename = String((workspace as any)?.slug || "workspace").replace(/[^a-z0-9-]/gi,"-") + "-export.json";
  return new Response(JSON.stringify(payload,null,2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      "Cache-Control": "private, no-store"
    }
  });
}
