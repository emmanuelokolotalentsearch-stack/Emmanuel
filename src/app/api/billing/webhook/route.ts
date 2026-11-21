import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function constantTimeHexMatch(received: string, expected: Buffer) {
  if (!/^[0-9a-f]{128}$/.test(received)) return false;
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function verifyModernSignature(raw: string, header: string) {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1") {
      const colon = value.indexOf(":");
      if (colon > 0) signatures.push(value.slice(colon + 1));
    }
  }
  if (!timestamp || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300 || signatures.length === 0) return false;
  const expected = createHmac("sha512", secret).update(String(timestamp) + "." + raw).digest();
  return signatures.some(signature => constantTimeHexMatch(signature, expected));
}

function verifyLegacySignature(raw: string, header: string) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !/^[0-9a-f]{128}$/.test(header)) return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  return constantTimeHexMatch(header, expected);
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
  const modernHeader = request.headers.get("paystack-signature") || "";
  const legacyHeader = request.headers.get("x-paystack-signature") || "";
  const valid = modernHeader
    ? verifyModernSignature(raw, modernHeader)
    : legacyHeader ? verifyLegacySignature(raw, legacyHeader) : false;
  if (!valid) return NextResponse.json({ error: "Invalid or missing Paystack webhook signature." }, { status: 401 });

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
      // Only update a workspace when the transaction reference or subscription code
      // is already associated with a checkout initiated by this application.
      if (existing) {
        const nextDate = data.subscription?.next_payment_date || existing.current_period_end || null;
        const { error } = await admin.from("subscriptions").update({
          status: "active", provider: "paystack",
          provider_subscription_code: code || existing.provider_subscription_code || null,
          provider_customer_code: data.customer?.customer_code || existing.provider_customer_code || null,
          customer_email: data.customer?.email || existing.customer_email || null,
          current_period_end: nextDate,
          cancel_at_period_end: false, updated_at: now
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
        // Avoid ambiguous matching when the same email has several same-plan workspaces.
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
