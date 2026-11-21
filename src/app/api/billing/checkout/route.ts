import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const planEnv: Record<string, string> = {
  starter: "PAYSTACK_PLAN_STARTER_CODE",
  growth: "PAYSTACK_PLAN_GROWTH_CODE",
  business: "PAYSTACK_PLAN_BUSINESS_CODE"
};

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; plan?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const plan = typeof body.plan === "string" ? body.plan : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !["starter", "growth", "business"].includes(plan)) return NextResponse.json({ error: "A valid workspace and paid plan are required." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Sign in with an email address to manage billing." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || member.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can change the subscription." }, { status: 403 });

  const secret = process.env.PAYSTACK_SECRET_KEY;
  const planCode = process.env[planEnv[plan]];
  const admin = createAdminClient();
  if (!secret || !planCode || !admin) return NextResponse.json({ error: "Billing is not configured. Add PAYSTACK_SECRET_KEY, the matching Paystack plan code, and SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const reference = "aws_" + randomUUID().replace(/-/g, "");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const init = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email, plan: planCode, reference, currency: "NGN",
      callback_url: appUrl.replace(/\/$/, "") + "/dashboard/billing?workspace_id=" + encodeURIComponent(workspaceId),
      metadata: { workspace_id: workspaceId, plan, user_id: user.id, integration: "ai-workforce-search" }
    }),
    signal: AbortSignal.timeout(25000)
  });
  const data = await init.json().catch(() => ({}));
  if (!init.ok || !data.status || !data.data?.authorization_url) return NextResponse.json({ error: data.message || "Paystack could not initialize checkout." }, { status: 502 });

  const { error } = await admin.from("subscriptions").upsert({
    workspace_id: workspaceId, plan, status: "pending", provider: "paystack",
    provider_reference: reference, customer_email: user.email, updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id" });
  if (error) return NextResponse.json({ error: "Checkout created, but local billing state could not be saved: " + error.message }, { status: 500 });
  return NextResponse.json({ authorization_url: data.data.authorization_url, reference });
}
