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
  const { data, error } = await ctx.supabase.from("jobs").select("*,applications(*)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ jobs: data || [] });
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot add jobs." }, { status: 403 });
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 2 || title.length > 200) return NextResponse.json({ error: "Job title must be between 2 and 200 characters." }, { status: 400 });
  const sourceUrl = typeof body.source_url === "string" && body.source_url.trim() ? body.source_url.trim() : null;
  if (sourceUrl) { try { const u = new URL(sourceUrl); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); } catch { return NextResponse.json({ error: "Job source URL must be a valid HTTP or HTTPS link." }, { status: 400 }); } }
  const { data, error } = await ctx.supabase.from("jobs").insert({
    workspace_id: workspaceId, created_by: ctx.user.id, title,
    company: typeof body.company === "string" ? body.company.trim().slice(0, 200) : null,
    location: typeof body.location === "string" ? body.location.trim().slice(0, 200) : null,
    employment_type: typeof body.employment_type === "string" ? body.employment_type.trim().slice(0, 80) : null,
    source_url: sourceUrl, description: typeof body.description === "string" ? body.description.slice(0, 12000) : ""
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ job: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot update jobs." }, { status: 403 });
  if (typeof body.id !== "string") return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  const allowed = ["saved", "interested", "applied", "interviewing", "closed"];
  if (body.status && !allowed.includes(body.status)) return NextResponse.json({ error: "Invalid job status." }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 12000);
  const { data, error } = await ctx.supabase.from("jobs").update(patch).eq("id", body.id).eq("workspace_id", workspaceId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ job: data });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id") || "";
  const id = url.searchParams.get("id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin"].includes(ctx.role)) return NextResponse.json({ error: "Only admins can delete jobs." }, { status: 403 });
  const { error } = await ctx.supabase.from("jobs").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
