import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return NextResponse.json({ error: "A valid workspace_id is required." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_workspace_usage", { target_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: error.message.includes("access denied") ? 403 : 503 });
  const rows = Array.isArray(data) ? data : [];
  return NextResponse.json({
    plan: rows[0]?.plan || "free",
    month_start: rows[0]?.month_start || new Date().toISOString().slice(0, 7) + "-01",
    features: rows.map(row => ({
      feature: row.feature,
      used: Number(row.used || 0),
      quota: Number(row.quota || 0),
      remaining: Number(row.remaining || 0)
    }))
  }, { headers: { "Cache-Control": "private, no-store" } });
}
