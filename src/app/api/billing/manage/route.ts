import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: { workspace_id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return NextResponse.json({ error: "Invalid workspace_id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || member.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can manage billing." }, { status: 403 });
  const { data: subscription, error } = await supabase.from("subscriptions")
    .select("provider,provider_subscription_code,status")
    .eq("workspace_id", workspaceId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (subscription?.provider !== "paystack" || !subscription.provider_subscription_code || !["active","past_due"].includes(subscription.status)) {
    return NextResponse.json({ error: "No active Paystack subscription is available to manage yet." }, { status: 409 });
  }
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "PAYSTACK_SECRET_KEY is not configured." }, { status: 503 });
  const response = await fetch("https://api.paystack.co/subscription/" + encodeURIComponent(subscription.provider_subscription_code) + "/manage/link", {
    method: "GET", headers: { Authorization: "Bearer " + secret }, signal: AbortSignal.timeout(20000), redirect: "error"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || typeof data.data?.link !== "string") return NextResponse.json({ error: data.message || "Could not create the Paystack subscription management link." }, { status: 502 });
  let link: URL;
  try { link = new URL(data.data.link); } catch { return NextResponse.json({ error: "Paystack returned an invalid management URL." }, { status: 502 }); }
  if (link.protocol !== "https:" || !(link.hostname === "paystack.com" || link.hostname.endsWith(".paystack.com"))) {
    return NextResponse.json({ error: "Paystack returned an untrusted management URL." }, { status: 502 });
  }
  return NextResponse.json({ url: link.toString() });
}
