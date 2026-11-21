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
function subscriptionCode(data: any) {
  return data?.subscription?.subscription_code || data?.subscription_code || null;
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
  const now = new Date().toISOString();

  try {
    if (event.event === "charge.success" && data.status === "success" && typeof data.reference === "string") {
      const code = subscriptionCode(data);
      let existing: any = null;
      if (code) {
        const byCode = await admin.from("subscriptions").select("*").eq("provider_subscription_code", code).maybeSingle();
        if (byCode.error) throw byCode.error;
        existing = byCode.data;
      }
      if (!existing) {
        const byReference = await admin.from("subscriptions").select("*").eq("provider_reference", data.reference).maybeSingle();
        if (byReference.error) throw byReference.error;
        existing = byReference.data;
      }
      if (existing) {
        const incomingCode = code || existing.provider_subscription_code || null;
        const nextDate = data.subscription?.next_payment_date || existing.current_period_end || null;
        const { error } = await admin.from("subscriptions").update({
          status: "active", provider: "paystack",
          provider_subscription_code: incomingCode,
          provider_customer_code: data.customer?.customer_code || existing.provider_customer_code || null,
          customer_email: data.customer?.email || existing.customer_email || null,
          current_period_end: nextDate,
          cancel_at_period_end: false,
          updated_at: now
        }).eq("workspace_id", existing.workspace_id);
        if (error) throw error;
      }
    }

    if (event.event === "subscription.create") {
      const plan = planFromCode(data.plan?.plan_code || data.plan?.plan);
      const email = data.customer?.email || data.customer?.customer?.email;
      if (plan && email && typeof data.subscription_code === "string") {
        const { data: matches, error } = await admin.from("subscriptions").select("workspace_id")
          .eq("customer_email", email).eq("plan", plan).in("status", ["pending","active"])
          .is("provider_subscription_code", null).limit(2);
        if (error) throw error;
        if (matches?.length === 1) {
          const patch: Record<string, unknown> = {
            status: "active", provider: "paystack", provider_subscription_code: data.subscription_code,
            provider_customer_code: data.customer?.customer_code || null, updated_at: now
          };
          if (data.next_payment_date) patch.current_period_end = data.next_payment_date;
          const { error: updateError } = await admin.from("subscriptions").update(patch).eq("workspace_id", matches[0].workspace_id);
          if (updateError) throw updateError;
        }
      }
    }

    if (event.event === "invoice.payment_failed") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions").update({ status: "past_due", updated_at: now }).eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }

    if (event.event === "invoice.update" && (data.paid === true || data.status === "success")) {
      const code = subscriptionCode(data);
      if (code) {
        const patch: Record<string, unknown> = { status: "active", updated_at: now };
        const nextDate = data.subscription?.next_payment_date || data.next_payment_date;
        if (nextDate) patch.current_period_end = nextDate;
        const { error } = await admin.from("subscriptions").update(patch).eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }

    if (event.event === "subscription.not_renew") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions").update({ cancel_at_period_end: true, updated_at: now }).eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }

    if (event.event === "subscription.disable") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions").update({ status: "cancelled", cancel_at_period_end: false, updated_at: now }).eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Subscription state update failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
