import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError) return NextResponse.json({ error: "Apply the platform administrator migration first." }, { status: 503 });
  if (!isAdmin) return NextResponse.json({ error: "Platform administrator access required." }, { status: 403 });
  const { data, error } = await supabase.rpc("platform_admin_stats");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ stats: data });
}
