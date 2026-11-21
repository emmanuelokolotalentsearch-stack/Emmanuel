# AI Workforce Search

AI-powered prospecting, recruitment CRM, and career-search SaaS.

## Included in this foundation
- Responsive marketing landing page.
- Supabase email/password sign-up and sign-in with a clear unconfigured state.
- Dashboard shell with authentication gating when Supabase is configured.
- Initial multi-tenant PostgreSQL schema with workspace roles and Row Level Security.
- Environment variable template. No credentials are committed.

## Stack
Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL, Lucide icons.

## Local setup
1. Install Node.js 20 or newer.
2. Copy .env.example to .env.local.
3. Create a Supabase project and fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
4. Apply supabase/migrations/0001_initial_schema.sql in the Supabase SQL editor.
5. Run npm install and npm run dev.
6. Open http://localhost:3000.

Without Supabase credentials, the public landing page works and login displays setup guidance. Authentication is not simulated.

## Security
- Keep service-role, AI, email, and payment keys server-side only.
- PostgreSQL RLS enforces workspace membership and roles.
- Use only licensed, public, or user-provided data you are authorized to process.
- No restricted-network scraping or access-control bypass.
- Outreach must remain human-reviewed and require provider setup, consent rules, and unsubscribe handling.

## Roadmap
1. Foundation and workspace onboarding.
2. Authorized people discovery, contact management, CSV import, email verification.
3. AI profile analysis, outreach drafting, templates, assistant.
4. Campaign scheduling, delivery, follow-ups, unsubscribe management.
5. Job discovery, matching, application tracking.
6. Billing, plan enforcement, team administration, testing, deployment.

This is an initial foundation, not a finished SaaS. Provider services require configuration and testing.
