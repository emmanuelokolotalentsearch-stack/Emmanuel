import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; contact_id?: unknown; email?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner","admin","member"].includes(member.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });
  let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (typeof body.contact_id === "string") {
    const { data: contact } = await supabase.from("contacts").select("email").eq("id", body.contact_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!contact?.email) return NextResponse.json({ error: "Contact or contact email not found." }, { status: 404 });
    email = contact.email.toLowerCase();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  const endpoint = process.env.EMAIL_VERIFICATION_API_URL, key = process.env.EMAIL_VERIFICATION_API_KEY;
  if (!endpoint || !key) return NextResponse.json({ error: "Email verification provider is not configured. Set EMAIL_VERIFICATION_API_URL and EMAIL_VERIFICATION_API_KEY." }, { status: 503 });
  let url: URL;
  try { url = new URL(endpoint); } catch { return NextResponse.json({ error: "EMAIL_VERIFICATION_API_URL is invalid." }, { status: 503 }); }
  if (url.protocol !== "https:") return NextResponse.json({ error: "Email verification provider URL must use HTTPS." }, { status: 503 });
  const { data: usage, error: usageError } = await supabase.rpc("consume_feature_usage", { target_workspace: workspaceId, feature_name: "email_verify", usage_units: 1 });
  if (usageError) return NextResponse.json({ error: "Usage guard unavailable. Apply migration 0003_usage_guardrails.sql." }, { status: 503 });
  const quota = Array.isArray(usage) ? usage[0] : usage;
  if (!quota?.allowed) return NextResponse.json({ error: "Monthly verification usage limit reached.", used: quota?.used, quota: quota?.quota }, { status: 429 });
  try {
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data?.message || "Verification provider failed." }, { status: 502 });
    const status = String(data.status || data.result || data.verdict || (data.is_valid === true ? "valid" : data.is_valid === false ? "invalid" : "unknown")).toLowerCase();
    return NextResponse.json({ email, status, score: typeof data.score === "number" ? data.score : null, reason: String(data.reason || data.message || "").slice(0,300), usage: quota });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Verification provider unavailable." }, { status: 502 }); }
}
