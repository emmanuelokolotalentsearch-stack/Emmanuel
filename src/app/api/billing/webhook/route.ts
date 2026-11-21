import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function constantTimeHexMatch(received: string, expected: Buffer) {
  if (!/^[0-9a-f]{128}$/i.test(received)) return false;
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function verifyModernSignature(raw: Buffer, header: string) {
  const secrets = [process.env.PAYSTACK_WEBHOOK_SECRET, process.env.PAYSTACK_WEBHOOK_PREVIOUS_SECRET]
    .filter((value): value is string => Boolean(value));
  if (!secrets.length) return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      if (timestamp !== null || !/^\d+$/.test(value)) return false;
      timestamp = Number(value);
    } else if (key === "v1") {
      const colon = value.indexOf(":");
      if (colon > 0) signatures.push(value.slice(colon + 1));
    }
  }
  if (timestamp === null || timestamp <= 0 ||
      Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300 || signatures.length === 0) return false;

  return secrets.some(secret => {
    const expected = createHmac("sha512", secret).update(String(timestamp) + ".").update(raw).digest();
    return signatures.some(signature => constantTimeHexMatch(signature, expected));
  });
}

function verifyLegacySignature(raw: Buffer, header: string) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !/^[0-9a-f]{128}$/i.test(header)) return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  return constantTimeHexMatch(header, expected);
}

function planAmount(plan: unknown) {
  if (typeof plan !== "string") return null;
  const value = Number(process.env["PAYSTACK_" + plan.toUpperCase() + "_AMOUNT_KOBO"] || "");
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function chargeMatchesPlan(subscription: any, data: any) {
  const expectedAmount = planAmount(subscription?.plan);
  return expectedAmount !== null &&
    Number(data?.amount) === expectedAmount &&
    String(data?.currency || "").toUpperCase() === "NGN";
}

function subscriptionCode(data: any) {
  return data?.subscription?.subscription_code || data?.subscription_code || null;
}

export async function POST(request: Request) {
  // Read raw bytes before parsing JSON: Paystack signs the exact request body.
  const raw = Buffer.from(await request.arrayBuffer());
  const modernHeader = request.headers.get("paystack-signature") || "";
  const legacyHeader = request.headers.get("x-paystack-signature") || "";
  const valid = modernHeader
    ? verifyModernSignature(raw, modernHeader)
    : legacyHeader ? verifyLegacySignature(raw, legacyHeader) : false;
  if (!valid) return NextResponse.json({ error: "Invalid or missing Paystack webhook signature." }, { status: 401 });

  let event: any;
  try { event = JSON.parse(raw.toString("utf8")); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Billing database is not configured." }, { status: 503 });
  const data = event?.data || {};
  const now = new Date().toISOString();

  try {
    if (event.event === "charge.success" && data.status === "success" && typeof data.reference === "string") {
      const code = subscriptionCode(data);
      let existing: any = null;

      if (code) {
        const result = await admin.from("subscriptions").select("*").eq("provider_subscription_code", code).maybeSingle();
        if (result.error) throw result.error;
        existing = result.data;
      }
      if (!existing) {
        const result = await admin.from("subscriptions").select("*").eq("provider_reference", data.reference).maybeSingle();
        if (result.error) throw result.error;
        existing = result.data;
      }

      // A transaction is linked to this application only if its reference or
      // subscription code was recorded by our server-side checkout flow.
      if (!existing) return NextResponse.json({ received: true, ignored: "unmatched_reference" });
      if (!chargeMatchesPlan(existing, data)) {
        return NextResponse.json({ error: "Charge amount/currency does not match the workspace plan." }, { status: 400 });
      }

      const { error } = await admin.from("subscriptions").update({
        status: "active",
        provider: "paystack",
        provider_subscription_code: code || existing.provider_subscription_code || null,
        provider_customer_code: data.customer?.customer_code || existing.provider_customer_code || null,
        customer_email: data.customer?.email || existing.customer_email || null,
        current_period_end: data.subscription?.next_payment_date || existing.current_period_end || null,
        cancel_at_period_end: false,
        updated_at: now
      }).eq("workspace_id", existing.workspace_id);
      if (error) throw error;
    }

    if (event.event === "subscription.create") {
      const planCode = data.plan?.plan_code || data.plan?.plan;
      const plan = typeof planCode === "string"
        ? (planCode === process.env.PAYSTACK_PLAN_STARTER_CODE ? "starter"
          : planCode === process.env.PAYSTACK_PLAN_GROWTH_CODE ? "growth"
          : planCode === process.env.PAYSTACK_PLAN_BUSINESS_CODE ? "business" : null)
        : null;
      const email = data.customer?.email || data.customer?.customer?.email;
      const code = data.subscription_code || data.subscription?.subscription_code;
      if (plan && email && typeof code === "string") {
        const { data: matches, error } = await admin.from("subscriptions").select("workspace_id")
          .eq("customer_email", email).eq("plan", plan).in("status", ["pending", "active"])
          .is("provider_subscription_code", null).limit(2);
        if (error) throw error;
        // Do not attach a Paystack subscription to the wrong tenant if the email
        // has several pending workspaces on the same plan.
        if (matches?.length === 1) {
          const { error: updateError } = await admin.from("subscriptions").update({
            provider: "paystack",
            provider_subscription_code: code,
            provider_customer_code: data.customer?.customer_code || null,
            current_period_end: data.next_payment_date || null,
            updated_at: now
          }).eq("workspace_id", matches[0].workspace_id);
          if (updateError) throw updateError;
        }
      }
    }

    if (event.event === "invoice.payment_failed") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions")
          .update({ status: "past_due", updated_at: now })
          .eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }

    if (event.event === "invoice.update" && (data.paid === true || data.status === "success")) {
      const code = subscriptionCode(data);
      if (code) {
        const { data: current, error: lookupError } = await admin.from("subscriptions")
          .select("workspace_id,plan").eq("provider_subscription_code", code).maybeSingle();
        if (lookupError) throw lookupError;
        if (current && ((data.amount === undefined || data.amount === null) || chargeMatchesPlan(current, data))) {
          const patch: Record<string, unknown> = { status: "active", updated_at: now };
          const nextDate = data.subscription?.next_payment_date || data.next_payment_date;
          if (nextDate) patch.current_period_end = nextDate;
          const { error } = await admin.from("subscriptions").update(patch).eq("workspace_id", current.workspace_id);
          if (error) throw error;
        }
      }
    }

    if (event.event === "subscription.not_renew") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions")
          .update({ cancel_at_period_end: true, updated_at: now })
          .eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }

    if (event.event === "subscription.disable") {
      const code = subscriptionCode(data);
      if (code) {
        const { error } = await admin.from("subscriptions")
          .update({ status: "cancelled", cancel_at_period_end: false, updated_at: now })
          .eq("provider_subscription_code", code);
        if (error) throw error;
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Subscription state update failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
