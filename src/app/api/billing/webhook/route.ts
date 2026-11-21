import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function safeEqualHex(value: string, expected: string) {
  try {
    const a = Buffer.from(value, "hex"), b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

function planFromCode(code: unknown) {
  if (typeof code !== "string") return null;
  if (code === process.env.PAYSTACK_PLAN_STARTER_CODE) return "starter";
  if (code === process.env.PAYSTACK_PLAN_GROWTH_CODE) return "growth";
  if (code === process.env.PAYSTACK_PLAN_BUSINESS_CODE) return "business";
  return null;
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("paystack-signature") || request.headers.get("x-paystack-signature") || "";
  const secret = request.headers.get("paystack-signature") ? process.env.PAYSTACK_WEBHOOK_SECRET : process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return NextResponse.json({ error: "Webhook signature configuration missing." }, { status: 401 });
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  if (!safeEqualHex(signature, expected)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Billing database is not configured." }, { status: 503 });
  const data = event?.data || {};

  if (event.event === "charge.success") {
    const meta = data.metadata || {};
    let workspaceId = typeof meta.workspace_id === "string" ? meta.workspace_id : "";
    let plan = typeof meta.plan === "string" ? meta.plan : "";
    const planCode = typeof data.plan === "string" ? data.plan : data.plan?.plan_code;
    if (!["starter", "growth", "business"].includes(plan)) plan = planFromCode(planCode) || "";
    if (!workspaceId && data.customer?.email && plan) {
      const { data: pending } = await admin.from("subscriptions").select("workspace_id")
        .eq("customer_email", data.customer.email).eq("plan", plan).eq("status", "pending").limit(2);
      if (pending?.length === 1) workspaceId = pending[0].workspace_id;
    }
    if (workspaceId && plan && data.status === "success") {
      await admin.from("subscriptions").upsert({
        workspace_id: workspaceId, plan, status: "active", provider: "paystack",
        provider_reference: data.reference || null, customer_email: data.customer?.email || null,
        provider_customer_code: data.customer?.customer_code || null,
        provider_subscription_code: data.subscription?.subscription_code || null,
        current_period_end: data.subscription?.next_payment_date || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "workspace_id" });
    }
  }

  if (event.event === "subscription.create") {
    const plan = planFromCode(data.plan?.plan_code || data.plan?.plan);
    const email = data.customer?.email || data.customer?.customer?.email;
    if (plan && email) {
      const { data: pending } = await admin.from("subscriptions").select("workspace_id,provider_reference")
        .eq("customer_email", email).eq("plan", plan).in("status", ["pending", "active"]).limit(2);
      if (pending?.length === 1) {
        await admin.from("subscriptions").update({
          status: "active", provider: "paystack",
          provider_subscription_code: data.subscription_code || null,
          provider_customer_code: data.customer?.customer_code || null,
          current_period_end: data.next_payment_date || null,
          updated_at: new Date().toISOString()
        }).eq("workspace_id", pending[0].workspace_id);
      }
    }
  }

  if (event.event === "invoice.payment_failed") {
    const subscriptionCode = data.subscription?.subscription_code || data.subscription_code;
    if (subscriptionCode) await admin.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("provider_subscription_code", subscriptionCode);
  }

  if (event.event === "invoice.update" && (data.paid === true || data.status === "success")) {
    const code = data.subscription?.subscription_code || data.subscription_code;
    if (code) await admin.from("subscriptions").update({ status: "active", current_period_end: data.subscription?.next_payment_date || null, updated_at: new Date().toISOString() }).eq("provider_subscription_code", code);
  }

  if (event.event === "subscription.not_renew") {
    const code = data.subscription_code;
    if (code) await admin.from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("provider_subscription_code", code);
  }

  if (event.event === "subscription.disable") {
    const code = data.subscription_code;
    if (code) await admin.from("subscriptions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("provider_subscription_code", code);
  }

  return NextResponse.json({ received: true });
}
