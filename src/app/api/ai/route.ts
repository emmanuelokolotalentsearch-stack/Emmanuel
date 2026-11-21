import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const tasks = ["profile_analysis", "outreach_draft", "job_match", "assistant"] as const;
type Task = typeof tasks[number];

function systemPrompt(task: Task) {
  if (task === "profile_analysis") return "You help recruiters and talent teams assess professional profile information supplied by the user. Only use the supplied facts. Do not infer protected characteristics, age, race, religion, health, family status, or other sensitive attributes. Do not invent employment history, skills, credentials, or achievements. Separate observed facts from uncertainties. Provide a concise summary, relevant skills, role alignment, evidence gaps, and suggested follow-up questions. State that this is decision support and must not replace human review.";
  if (task === "outreach_draft") return "You write concise, respectful, personalized professional outreach drafts. Use only facts explicitly supplied by the user. Never fabricate a relationship, job opening, shared experience, or personal detail. Avoid manipulative language. Provide a useful subject line and message body. This is a draft for human review, not a message being sent.";
  return "You are the AI assistant for a professional workforce search and recruitment workspace. Be accurate, practical, privacy-conscious, and transparent about uncertainty. Never make up data or claim to have searched external sources unless results were supplied.";
}

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; task?: unknown; input?: unknown; context?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return NextResponse.json({ error: "A valid workspace_id is required." }, { status: 400 });
  if (!tasks.includes(body.task as Task)) return NextResponse.json({ error: "Unsupported AI task." }, { status: 400 });
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const context = typeof body.context === "string" ? body.context.trim() : "";
  if (input.length < 3 || input.length > 12000 || context.length > 12000) return NextResponse.json({ error: "Input must be 3–12,000 characters and context cannot exceed 12,000 characters." }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin", "member"].includes(member.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI is not configured. Add OPENAI_API_KEY as a server environment variable." }, { status: 503 });

  const { data: quota, error: quotaError } = await supabase.rpc("consume_feature_usage", {
    target_workspace: workspaceId, feature_name: "ai_" + body.task, usage_units: 1
  });
  if (quotaError) return NextResponse.json({ error: "Could not verify workspace AI usage. Apply migration 0003_usage_guardrails.sql.", detail: quotaError.message }, { status: 503 });
  const usage = Array.isArray(quota) ? quota[0] : quota;
  if (!usage?.allowed) return NextResponse.json({ error: "This workspace has reached its monthly AI usage limit.", used: usage?.used, quota: usage?.quota }, { status: 429 });

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0.35, max_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt(body.task as Task) },
        { role: "user", content: (context ? "Context supplied by the user:\n" + context + "\n\n" : "") + input }
      ]
    }),
    signal: AbortSignal.timeout(45000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: result?.error?.message || "AI provider request failed. Check the server API key and model settings." }, { status: 502 });
  const output = result?.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) return NextResponse.json({ error: "AI provider returned an empty response." }, { status: 502 });
  return NextResponse.json({ output, model, usage: { used: usage.used, quota: usage.quota } });
}
