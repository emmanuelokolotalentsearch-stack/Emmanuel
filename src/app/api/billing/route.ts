import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || member.role !== "owner") return NextResponse.json({ error: "Workspace owner access required." }, { status: 403 });
  const { data, error } = await supabase.from("subscriptions").select("plan,status,provider,customer_email,current_period_end,cancel_at_period_end,updated_at").eq("workspace_id", workspaceId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ subscription: data || { plan: "free", status: "free" } });
}
