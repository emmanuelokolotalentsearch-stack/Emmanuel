import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 120) : "";
  const employmentType = typeof body.employment_type === "string" ? body.employment_type.trim().slice(0, 80) : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || query.length < 2) return NextResponse.json({ error: "A workspace and a job-search query of at least 2 characters are required." }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner","admin","member"].includes(member.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });

  const endpoint = process.env.JOB_SEARCH_API_URL, key = process.env.JOB_SEARCH_API_KEY;
  if (!endpoint || !key) return NextResponse.json({ error: "Job discovery provider is not configured. Set JOB_SEARCH_API_URL and JOB_SEARCH_API_KEY for a licensed job feed." }, { status: 503 });
  let url: URL;
  try { url = new URL(endpoint); } catch { return NextResponse.json({ error: "JOB_SEARCH_API_URL is invalid." }, { status: 503 }); }
  if (url.protocol !== "https:") return NextResponse.json({ error: "Job provider URL must use HTTPS." }, { status: 503 });

  const { data: usage, error: usageError } = await supabase.rpc("consume_feature_usage", {
    target_workspace: workspaceId, feature_name: "job_search", usage_units: 1
  });
  if (usageError) return NextResponse.json({ error: "Usage guard unavailable. Apply migration 0003_usage_guardrails.sql." }, { status: 503 });
  const quota = Array.isArray(usage) ? usage[0] : usage;
  if (!quota?.allowed) return NextResponse.json({ error: "Monthly job-search usage limit reached.", used: quota?.used, quota: quota?.quota }, { status: 429 });

  try {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query, filters: { location, employment_type: employmentType },
        limit: 25, page: 1
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data?.message || "Job provider request failed." }, { status: 502 });
    const rows = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : Array.isArray(data.data?.results) ? data.data.results : Array.isArray(data.data) ? data.data : [];
    const jobs = rows.slice(0,25).map((row: any) => ({
      title: String(row.title || row.job_title || "").trim().slice(0,200),
      company: String(row.company?.name || row.company || row.employer?.name || "").trim().slice(0,200) || null,
      location: String(row.location?.name || row.location || row.city || "").trim().slice(0,200) || null,
      employment_type: String(row.employment_type || row.job_type || row.type || "").trim().slice(0,80) || null,
      source_url: safeHttpUrl(row.source_url || row.apply_url || row.url || row.job_url),
      description: String(row.description || row.summary || "").trim().slice(0,12000),
      source: String(row.source || row.provider || "licensed_provider").slice(0,120)
    })).filter((job: any) => job.title && job.source_url);
    return NextResponse.json({ jobs, count: jobs.length, usage: { used: quota.used, quota: quota.quota } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Job provider unavailable." }, { status: 502 });
  }
}
