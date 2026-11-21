import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 120) : "";
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 120) : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || (query.length < 2 && !title && !company && !location)) return NextResponse.json({ error: "Provide a workspace and at least one search term or filter." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner","admin","member"].includes(member.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });

  const endpoint = process.env.PEOPLE_SEARCH_API_URL;
  const apiKey = process.env.PEOPLE_SEARCH_API_KEY;
  if (!endpoint || !apiKey) return NextResponse.json({ error: "People search provider is not configured. Set PEOPLE_SEARCH_API_URL and PEOPLE_SEARCH_API_KEY to a licensed provider that permits this use." }, { status: 503 });
  let endpointUrl: URL;
  try { endpointUrl = new URL(endpoint); } catch { return NextResponse.json({ error: "PEOPLE_SEARCH_API_URL is invalid." }, { status: 503 }); }
  if (endpointUrl.protocol !== "https:") return NextResponse.json({ error: "People search provider URL must use HTTPS." }, { status: 503 });

  const { data: usage, error: usageError } = await supabase.rpc("consume_feature_usage", { target_workspace: workspaceId, feature_name: "people_search", usage_units: 1 });
  if (usageError) return NextResponse.json({ error: "Usage guard unavailable. Apply migration 0003_usage_guardrails.sql." }, { status: 503 });
  const quota = Array.isArray(usage) ? usage[0] : usage;
  if (!quota?.allowed) return NextResponse.json({ error: "Monthly people-search usage limit reached.", used: quota?.used, quota: quota?.quota }, { status: 429 });

  try {
    const provider = await fetch(endpointUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, filters: { title, company, location }, limit: 25, page: 1 })
    });
    const result = await provider.json().catch(() => ({}));
    if (!provider.ok) return NextResponse.json({ error: result?.message || "Search provider request failed." }, { status: 502 });
    const records = Array.isArray(result) ? result : Array.isArray(result.results) ? result.results : Array.isArray(result.data?.results) ? result.data.results : Array.isArray(result.data) ? result.data : [];
    const people = records.slice(0,25).map((row: any) => ({
      full_name: String(row.full_name || row.name || [row.first_name,row.last_name].filter(Boolean).join(" ") || "").trim(),
      email: String(row.email || row.email_address || "").trim() || null,
      company: typeof row.company === "string" ? row.company : row.company?.name || row.organization?.name || null,
      job_title: row.job_title || row.title || row.current_title || null,
      location: typeof row.location === "string" ? row.location : row.location?.name || row.city || null,
      linkedin_url: row.linkedin_url || row.profile_url || row.url || null,
      source: String(row.source || row.provider || "licensed_provider")
    })).filter((person: any) => person.full_name);
    return NextResponse.json({ people, count: people.length, usage: { used: quota.used, quota: quota.quota } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Search provider unavailable." }, { status: 502 });
  }
}
