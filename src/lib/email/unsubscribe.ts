import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET;
  if (!value || value.length < 32) throw new Error("UNSUBSCRIBE_SECRET must contain at least 32 characters.");
  return value;
}

export function createUnsubscribeToken(workspaceId: string, contactId: string) {
  const payload = Buffer.from(JSON.stringify({ workspaceId, contactId })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyUnsubscribeToken(token: string): { workspaceId: string; contactId: string } | null {
  try {
    const [payload, supplied] = token.split(".");
    if (!payload || !supplied) return null;
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(supplied, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value.workspaceId !== "string" || typeof value.contactId !== "string") return null;
    return value;
  } catch { return null; }
}
