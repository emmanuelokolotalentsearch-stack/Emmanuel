import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data, error } = await supabase.from("workspace_members")
    .select("workspace_id, role, workspaces(id,name,slug,created_at)")
    .eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const workspaces = (data ?? []).map((item: any) => ({ ...item.workspaces, role: item.role }));
  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let body: { name?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Workspace name must be between 2 and 120 characters." }, { status: 400 });
  const base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "workspace";
  const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await supabase.rpc("create_workspace", { workspace_name: name, workspace_slug: slug });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const workspaceId = data as string;
  await supabase.from("workspace_settings").upsert({ workspace_id: workspaceId, settings: {} });
  await supabase.from("subscriptions").upsert({ workspace_id: workspaceId, plan: "free", status: "free" });
  return NextResponse.json({ workspace: { id: workspaceId, name, slug }, message: "Workspace created." }, { status: 201 });
}
