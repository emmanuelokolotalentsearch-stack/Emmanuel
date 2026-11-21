import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function constantTimeHexMatch(received: string, expected: Buffer) {
  if (!/^[0-9a-f]{128}$/.test(received)) return false;
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function verifyModernSignature(raw: string, header: string) {
  const secrets = [process.env.PAYSTACK_WEBHOOK_SECRET, process.env.PAYSTACK_WEBHOOK_PREVIOUS_SECRET]
    .filter((value): value is string => Boolean(value));
  if (!secrets.length) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t") {
      if (timestamp !== null || !/^\d+$/.test(value)) return false;
      timestamp = Number(value);
    }
    if (key === "v1") {
      const colon = value.indexOf(":");
      if (colon > 0) signatures.push(value.slice(colon + 1));
    }
  }
  if (timestamp === null || timestamp <= 0 || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300 || signatures.length === 0) return false;
  return secrets.some(secret => {
    const expected = createHmac("sha512", secret).update(String(timestamp) + "." + raw).digest();
    return signatures.some(signature => constantTimeHexMatch(signature, expected));
  });
}

