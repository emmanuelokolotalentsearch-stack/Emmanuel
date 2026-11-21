import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function authorize(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return { error: NextResponse.json({ error: "Invalid workspace_id." }, { status: 400 }) } as const;
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return { error: NextResponse.json({ error: "Workspace owner or admin access required." }, { status: 403 }) } as const;
  const admin = createAdminClient();
  if (!admin) return { error: NextResponse.json({ error: "Set SUPABASE_SERVICE_ROLE_KEY to enable secure team administration." }, { status: 503 }) } as const;
  return { supabase, admin, user, role: member.role } as const;
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const ctx = await authorize(workspaceId);
  if ("error" in ctx) return ctx.error;
  const { data: members, error } = await ctx.admin.from("workspace_members").select("user_id,role,created_at").eq("workspace_id", workspaceId).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const enriched = await Promise.all((members || []).map(async (member) => {
    const { data } = await ctx.admin.auth.admin.getUserById(member.user_id);
    return { ...member, email: data.user?.email || "Pending invitation" };
  }));
  return NextResponse.json({ members: enriched });
}

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; email?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await authorize(workspaceId);
  if ("error" in ctx) return ctx.error;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!["admin", "member", "viewer"].includes(role as string)) return NextResponse.json({ error: "Choose admin, member, or viewer." }, { status: 400 });
  if (ctx.role !== "owner" && role === "admin") return NextResponse.json({ error: "Only the workspace owner can invite administrators." }, { status: 403 });

  const { data: invitation, error: inviteError } = await ctx.admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin}/login`
  });
  if (inviteError || !invitation.user) {
    return NextResponse.json({ error: inviteError?.message || "Invitation could not be created. The email may already have an account or invitation." }, { status: 400 });
  }
  const { error } = await ctx.admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: invitation.user.id, role });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ invited: true, email, role }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: { workspace_id?: unknown; user_id?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await authorize(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (ctx.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can change member roles." }, { status: 403 });
  if (typeof body.user_id !== "string" || !["admin", "member", "viewer"].includes(body.role as string)) return NextResponse.json({ error: "A member and valid role are required." }, { status: 400 });
  const { error } = await ctx.admin.from("workspace_members").update({ role: body.role }).eq("workspace_id", workspaceId).eq("user_id", body.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id") || "";
  const userId = url.searchParams.get("user_id") || "";
  const ctx = await authorize(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!userId) return NextResponse.json({ error: "user_id is required." }, { status: 400 });
  const { data: target } = await ctx.admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (target.role === "owner" && ctx.role !== "owner") return NextResponse.json({ error: "Only the owner can remove an owner." }, { status: 403 });
  const { error } = await ctx.admin.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
