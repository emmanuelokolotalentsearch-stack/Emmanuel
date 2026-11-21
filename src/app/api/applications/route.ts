import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function context(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return { error: NextResponse.json({ error: "Invalid workspace_id." }, { status: 400 }) } as const;
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ error: "Workspace access denied." }, { status: 403 }) } as const;
  return { supabase, user, role: member.role } as const;
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.supabase.from("applications").select("*,jobs(title,company,source_url)").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ applications: data || [] });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot track applications." }, { status: 403 });
  if (typeof body.job_id !== "string") return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  const { data: job } = await ctx.supabase.from("jobs").select("id").eq("id", body.job_id).eq("workspace_id", workspaceId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found in this workspace." }, { status: 404 });
  const { data, error } = await ctx.supabase.from("applications").insert({ workspace_id: workspaceId, job_id: job.id, created_by: ctx.user.id, notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : "" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await ctx.supabase.from("jobs").update({ status: "interested", updated_at: new Date().toISOString() }).eq("id", job.id);
  return NextResponse.json({ application: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot update applications." }, { status: 403 });
  const allowed = ["planned", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];
  if (typeof body.id !== "string" || !allowed.includes(body.status)) return NextResponse.json({ error: "Application id and valid status are required." }, { status: 400 });
  const patch = { status: body.status, notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : undefined, applied_at: body.status === "applied" ? new Date().toISOString() : undefined, updated_at: new Date().toISOString() };
  const { data, error } = await ctx.supabase.from("applications").update(patch).eq("id", body.id).eq("workspace_id", workspaceId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ application: data });
}
