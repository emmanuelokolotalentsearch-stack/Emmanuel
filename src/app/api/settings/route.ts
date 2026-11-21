import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const status = () => ({
  supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
  ai: Boolean(process.env.OPENAI_API_KEY),
  peopleSearch: Boolean(process.env.PEOPLE_SEARCH_API_URL && process.env.PEOPLE_SEARCH_API_KEY),
  emailVerification: Boolean(process.env.EMAIL_VERIFICATION_API_URL && process.env.EMAIL_VERIFICATION_API_KEY),
  emailDelivery: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.UNSUBSCRIBE_SECRET),
  paystack: Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PLAN_STARTER_CODE && process.env.PAYSTACK_PLAN_GROWTH_CODE && process.env.PAYSTACK_PLAN_BUSINESS_CODE)
});

async function getContext(workspaceId: string) {
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
  const ctx = await getContext(workspaceId);
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.supabase.from("workspace_settings").select("settings,updated_at").eq("workspace_id", workspaceId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ settings: data?.settings || {}, updated_at: data?.updated_at || null, integrations: status() });
}

export async function PATCH(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await getContext(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner","admin"].includes(ctx.role)) return NextResponse.json({ error: "Workspace admin access required." }, { status: 403 });
  const source = body.settings && typeof body.settings === "object" ? body.settings : {};
  const settings = {
    company_website: typeof source.company_website === "string" ? source.company_website.trim().slice(0,300) : "",
    timezone: typeof source.timezone === "string" ? source.timezone.slice(0,80) : "Africa/Lagos",
    default_email_signature: typeof source.default_email_signature === "string" ? source.default_email_signature.slice(0,2000) : "",
    default_outreach_tone: ["professional","friendly","concise"].includes(source.default_outreach_tone) ? source.default_outreach_tone : "professional"
  };
  if (settings.company_website) { try { const u = new URL(settings.company_website); if (!["https:","http:"].includes(u.protocol)) throw new Error(); } catch { return NextResponse.json({ error: "Company website must be a valid HTTP or HTTPS URL." }, { status: 400 }); } }
  const { data, error } = await ctx.supabase.from("workspace_settings").upsert({ workspace_id: workspaceId, settings, updated_at: new Date().toISOString() }).select("settings,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
