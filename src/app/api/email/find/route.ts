import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: { workspace_id?: unknown; first_name?: unknown; last_name?: unknown; domain?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const firstName = typeof body.first_name === "string" ? body.first_name.trim().slice(0,100) : "";
  const lastName = typeof body.last_name === "string" ? body.last_name.trim().slice(0,100) : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"") : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !firstName || !lastName || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) return NextResponse.json({ error: "Workspace, first name, last name, and a company domain are required." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: member } = await supabase.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if (!member || !["owner","admin","member"].includes(member.role)) return NextResponse.json({ error: "Workspace editor access required." }, { status: 403 });
  const endpoint=process.env.PEOPLE_EMAIL_FINDER_API_URL,key=process.env.PEOPLE_EMAIL_FINDER_API_KEY;
  if(!endpoint||!key)return NextResponse.json({error:"Email finder is not configured. Set PEOPLE_EMAIL_FINDER_API_URL and PEOPLE_EMAIL_FINDER_API_KEY."},{status:503});
  let url:URL;try{url=new URL(endpoint);}catch{return NextResponse.json({error:"PEOPLE_EMAIL_FINDER_API_URL is invalid."},{status:503});}
  if(url.protocol!=="https:")return NextResponse.json({error:"Email finder provider URL must use HTTPS."},{status:503});
  const {data:usage,error:usageError}=await supabase.rpc("consume_feature_usage",{target_workspace:workspaceId,feature_name:"email_find",usage_units:1});
  if(usageError)return NextResponse.json({error:"Usage guard unavailable. Apply migration 0003_usage_guardrails.sql."},{status:503});
  const quota=Array.isArray(usage)?usage[0]:usage;if(!quota?.allowed)return NextResponse.json({error:"Monthly email-finder usage limit reached.",used:quota?.used,quota:quota?.quota},{status:429});
  try{
    const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({first_name:firstName,last_name:lastName,domain})});
    const data=await response.json().catch(()=>({}));if(!response.ok)return NextResponse.json({error:data?.message||"Email finder provider failed."},{status:502});
    const result=data.data||data;const email=typeof result.email==="string"?result.email.trim().toLowerCase():"";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:"Provider did not return a valid email address.",found:false,confidence:result.confidence??null});
    return NextResponse.json({found:true,email,confidence:typeof result.confidence==="number"?result.confidence:null,source:String(result.source||"licensed_provider"),usage:quota});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Email finder provider unavailable."},{status:502});}
}
