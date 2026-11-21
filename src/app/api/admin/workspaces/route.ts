import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: isAdmin, error: authError } = await supabase.rpc("is_platform_admin");
  if (authError) return NextResponse.json({ error: "Apply the platform administrator migration first." }, { status: 503 });
  if (!isAdmin) return NextResponse.json({ error: "Platform administrator access required." }, { status: 403 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Server-side admin client is not configured." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(1000, Number(params.get("page") || 1)));
  const term = (params.get("q") || "").trim().slice(0, 100);
  const start = (page - 1) * 25;
  let query = admin.from("workspaces").select("id,name,slug,created_by,created_at", { count: "exact" }).order("created_at", { ascending: false });
  if (term) query = query.or("name.ilike.%" + term.replace(/[%_]/g, "") + "%,slug.ilike.%" + term.replace(/[%_]/g, "") + "%");
  const { data: workspaces, count, error } = await query.range(start, start + 24);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const ids = (workspaces || []).map(w => w.id);
  if (!ids.length) return NextResponse.json({ workspaces: [], total: count || 0, page, page_size: 25 });

  const [subscriptions, memberships] = await Promise.all([
    admin.from("subscriptions").select("workspace_id,plan,status,current_period_end").in("workspace_id", ids),
    admin.from("workspace_members").select("workspace_id").in("workspace_id", ids).limit(10000)
  ]);
  if (subscriptions.error || memberships.error) return NextResponse.json({ error: subscriptions.error?.message || memberships.error?.message }, { status: 400 });
  const subByWorkspace = new Map((subscriptions.data || []).map(s => [s.workspace_id, s]));
  const memberCounts = new Map<string, number>();
  for (const member of memberships.data || []) memberCounts.set(member.workspace_id, (memberCounts.get(member.workspace_id) || 0) + 1);

  return NextResponse.json({
    workspaces: (workspaces || []).map(w => ({
      ...w, member_count: memberCounts.get(w.id) || 0,
      subscription: subByWorkspace.get(w.id) || { plan: "free", status: "free", current_period_end: null }
    })),
    total: count || 0, page, page_size: 25
  });
}
