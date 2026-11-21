import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Activity, ArrowUpRight, BrainCircuit, BriefcaseBusiness, FileSearch, LayoutDashboard, Mail, Search, Settings2, ShieldCheck, Users, CreditCard, UserCog, CalendarClock, AtSign } from "lucide-react";

const nav = [
  ["Overview","/dashboard",LayoutDashboard],["People search","/dashboard/search",Search],["Email finder","/dashboard/email-finder",AtSign],["Contacts","/dashboard/contacts",Users],
  ["Outreach","/dashboard/outreach",Mail],["Campaigns","/dashboard/campaigns",CalendarClock],["AI assistant","/dashboard/assistant",BrainCircuit],["Jobs & careers","/dashboard/jobs",BriefcaseBusiness],
  ["Team","/dashboard/team",UserCog],["Usage","/dashboard/usage",Activity],["Billing","/dashboard/billing",CreditCard]
] as const;

export default async function Dashboard() {
  const supabase = await createClient();
  let user: any = null, workspace: any = null, role = "", stats = { contacts: null as number|null, prospects: null as number|null, sent: null as number|null, jobs: null as number|null }, recent: any[] = [], isPlatformAdmin = false;
  if (supabase) {
    const auth = await supabase.auth.getUser();
    user = auth.data.user;
    if (!user) redirect("/login");
    const { data: memberships } = await supabase.from("workspace_members").select("workspace_id,role,workspaces(id,name,slug)").eq("user_id", user.id).order("created_at", { ascending: true });
    const membership = memberships?.[0];
    if (membership) {
      workspace = membership.workspaces; role = membership.role;
      const id = membership.workspace_id;
      const [contacts, prospects, sent, jobs, activities] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", id),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", id).in("stage", ["contacted","engaged","qualified"]),
        supabase.from("outreach_messages").select("id", { count: "exact", head: true }).eq("workspace_id", id).eq("status", "sent"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("workspace_id", id).neq("status", "closed"),
        supabase.from("activities").select("id,kind,summary,created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(6)
      ]);
      stats = { contacts: contacts.count ?? null, prospects: prospects.count ?? null, sent: sent.count ?? null, jobs: jobs.count ?? null };
      recent = activities.data || [];
    }
    const admin = await supabase.rpc("is_platform_admin");
    isPlatformAdmin = admin.data === true;
  }

  const configured = !!supabase;
  const values = [
    ["People saved", stats.contacts, "Contacts in this workspace", Users],
    ["Active prospects", stats.prospects, "Contacted, engaged, or qualified", Search],
    ["Outreach sent", stats.sent, "Messages confirmed as sent", Mail],
    ["Open opportunities", stats.jobs, "Saved jobs not marked closed", BriefcaseBusiness]
  ] as const;

  return <div className="flex min-h-screen">
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-100 bg-white px-5 py-6 lg:flex">
      <Link href="/" className="mb-10 flex items-center gap-3 font-extrabold"><span className="rounded-xl bg-[#6258e8] p-2 text-white"><BrainCircuit/></span>workforce<span className="-ml-3 text-violet-600">.ai</span></Link>
      <p className="px-3 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Workspace</p>
      <nav className="mt-3 space-y-1">{nav.map(([label,href,Icon],i)=><Link key={href} href={href} className={"navlink "+(i===0?"active":"")}><Icon size={17}/>{label}</Link>)}</nav>
      <Link href="/dashboard/settings" className="navlink mt-4"><Settings2 size={17}/>Settings</Link>
      {isPlatformAdmin && <Link href="/dashboard/admin" className="navlink"><ShieldCheck size={17}/>Super admin</Link>}
      <div className="mt-auto rounded-xl bg-violet-50 p-4"><p className="text-xs font-extrabold text-violet-800">Set up your workspace</p><p className="mt-2 text-xs leading-5 text-slate-500">Connect trusted providers to enable search, AI, messaging, and billing.</p><Link href="/dashboard/settings" className="mt-3 inline-flex text-xs font-bold text-violet-700">Configure <ArrowUpRight size={13}/></Link></div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="flex h-[74px] items-center justify-between border-b border-slate-100 bg-white px-5 sm:px-8"><div><p className="text-xs text-slate-400">{workspace?.name || "Workspace"} / Overview</p><h1 className="mt-1 font-extrabold">Dashboard</h1></div><div className="text-right"><span className={"rounded-full px-3 py-1.5 text-[11px] font-bold "+(configured?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700")}>{configured?"Connected":"Setup required"}</span>{user?.email&&<p className="mt-1 text-[10px] text-slate-400">{user.email}{role?" · "+role:""}</p>}</div></header>
      <div className="mx-auto max-w-7xl p-5 sm:p-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Command centre</p><h2 className="mt-2 text-2xl font-black sm:text-3xl">Your work, in one place.</h2><p className="mt-2 text-sm text-slate-500">A live view of your workforce search activity.</p></div><Link href="/dashboard/search" className="btn"><Search size={16}/> Start a search</Link></div>
        {!configured && <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><ShieldCheck size={19} className="shrink-0 text-amber-700"/><div><p className="text-sm font-extrabold text-amber-900">Supabase setup required</p><p className="mt-1 text-xs leading-5 text-amber-800">Add your project URL and anon key to the server environment and apply all database migrations. Authentication and persistent data are unavailable until setup is complete.</p></div></div>}
        {configured && !workspace && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-5"><div><p className="font-extrabold text-violet-900">Create your first workspace</p><p className="mt-1 text-xs text-violet-800">Your CRM, team, jobs, and activity will be isolated in a workspace.</p></div><Link href="/dashboard/contacts" className="btn">Create workspace</Link></div>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{values.map(([label,value,note,Icon])=><div className="card p-5" key={label}><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Icon size={18}/></span></div><p className="mt-4 text-3xl font-black">{value===null?"—":value.toLocaleString()}</p><p className="mt-1 text-[11px] text-slate-400">{workspace?note:"No workspace data"}</p></div>)}</div>
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <section className="card p-6"><div className="flex items-center justify-between"><div><h3 className="font-extrabold">Recent activity</h3><p className="mt-1 text-xs text-slate-400">Latest workspace updates</p></div><Activity size={18} className="text-slate-400"/></div>
            {recent.length ? <div className="mt-5 space-y-4">{recent.map(item=><div key={item.id} className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-500"/><div><p className="text-xs font-semibold text-slate-700">{item.summary}</p><p className="mt-1 text-[10px] capitalize text-slate-400">{item.kind} · {new Date(item.created_at).toLocaleString()}</p></div></div>)}</div> : <div className="flex min-h-40 flex-col items-center justify-center text-center"><FileSearch size={25} className="text-slate-300"/><p className="mt-3 text-sm font-bold">No activity to show yet</p><p className="mt-1 text-xs text-slate-400">Your CRM and workspace updates will appear here.</p></div>}
          </section>
          <section className="card p-6"><h3 className="font-extrabold">Quick actions</h3><div className="mt-5 space-y-3">{[["Search professionals","Discover professionals from licensed sources","/dashboard/search",Search],["Find a business email","Use your licensed email-finder provider","/dashboard/email-finder",AtSign],["Manage contacts","Review saved relationships","/dashboard/contacts",Users],["Prepare outreach","Write messages and review drafts","/dashboard/outreach",Mail],["Schedule campaigns","Prepare opt-in campaign follow-ups","/dashboard/campaigns",CalendarClock],["Configure integrations","Connect trusted providers","/dashboard/settings",Settings2]].map(([title,desc,href,Icon]:any)=><Link key={title} href={href} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:bg-violet-50"><Icon size={18} className="text-violet-700"/><span className="flex-1"><span className="block text-xs font-extrabold">{title}</span><span className="text-[11px] text-slate-400">{desc}</span></span><ArrowUpRight size={15}/></Link>)}</div></section>
        </div>
      </div>
    </main>
  </div>;
}
