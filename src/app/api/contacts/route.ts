import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const stages = ["new", "contacted", "engaged", "qualified", "archived"] as const;
type ContactInput = { full_name?: unknown; email?: unknown; company?: unknown; job_title?: unknown; source?: unknown; notes?: unknown; stage?: unknown; linkedin_url?: unknown; location?: unknown; email_opt_in?: unknown; email_consent_note?: unknown };

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function context(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return { error: NextResponse.json({ error: "Invalid workspace_id." }, { status: 400 }) } as const;
  const { data: member, error } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (error || !member) return { error: NextResponse.json({ error: "Workspace not found or access denied." }, { status: 403 }) } as const;
  return { supabase, user, role: member.role } as const;
}
function normalizeContact(input: ContactInput) {
  const full_name = cleanText(input.full_name, 200);
  const email = cleanText(input.email, 320).toLowerCase();
  const stage = stages.includes(input.stage as any) ? input.stage as string : "new";
  const email_opt_in = input.email_opt_in === true;
  const email_consent_note = cleanText(input.email_consent_note, 1000);
  if (!full_name) throw new Error("Every contact needs a name.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email address for ${full_name}.`);
  if (email_opt_in && email_consent_note.length < 10) throw new Error("Record how and when this person agreed to receive marketing emails (at least 10 characters).");
  return {
    full_name, email: email || null,
    company: cleanText(input.company, 200) || null,
    job_title: cleanText(input.job_title, 200) || null,
    source: cleanText(input.source, 100) || "manual",
    notes: cleanText(input.notes, 5000) || null, stage,
    linkedin_url: cleanText(input.linkedin_url, 500) || null,
    location: cleanText(input.location, 200) || null,
    email_opt_in,
    email_opt_in_at: email_opt_in ? new Date().toISOString() : null,
    email_consent_source: email_opt_in ? "workspace_user_attestation" : null,
    email_consent_note: email_opt_in ? email_consent_note : null,
    ...(email_opt_in ? { email_unsubscribed_at: null } : {})
  };
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.supabase.from("contacts").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; contacts?: unknown } & ContactInput;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot add contacts." }, { status: 403 });
  try {
    const raw = Array.isArray(body.contacts) ? body.contacts : [body];
    if (raw.length < 1 || raw.length > 500) return NextResponse.json({ error: "Import between 1 and 500 contacts at a time." }, { status: 400 });
    const rows = raw.map((item) => ({ ...normalizeContact(item as ContactInput), workspace_id: workspaceId, created_by: ctx.user.id }));
    const { data, error } = await ctx.supabase.from("contacts").insert(rows).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await ctx.supabase.from("activities").insert({ workspace_id: workspaceId, actor_id: ctx.user.id, kind: "search", summary: `Added ${rows.length} contact(s) to the CRM.` });
    return NextResponse.json({ contacts: data ?? [], count: rows.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid contact data." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  let body: { workspace_id?: unknown; id?: unknown } & ContactInput;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin", "member"].includes(ctx.role)) return NextResponse.json({ error: "Your role cannot update contacts." }, { status: 403 });
  if (typeof body.id !== "string") return NextResponse.json({ error: "Contact id is required." }, { status: 400 });
  try {
    const patch = normalizeContact(body);
    const { data, error } = await ctx.supabase.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", body.id).eq("workspace_id", workspaceId).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await ctx.supabase.from("activities").insert({ workspace_id: workspaceId, actor_id: ctx.user.id, contact_id: body.id, kind: "status_change", summary: `Updated contact: ${data.full_name}.` });
    return NextResponse.json({ contact: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid contact data." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id") || "";
  const id = url.searchParams.get("id") || "";
  const ctx = await context(workspaceId);
  if ("error" in ctx) return ctx.error;
  if (!["owner", "admin"].includes(ctx.role)) return NextResponse.json({ error: "Only workspace admins can delete contacts." }, { status: 403 });
  if (!id) return NextResponse.json({ error: "Contact id is required." }, { status: 400 });
  const { error } = await ctx.supabase.from("contacts").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
