# AI Workforce Search

AI Workforce Search is a multi-tenant SaaS foundation for professional discovery, recruiting CRM, AI-assisted workflows, outreach, and job/application tracking.

## Implemented in this repository

- Responsive public landing page, Supabase email/password authentication, and protected dashboard.
- Multi-tenant workspaces, membership roles, PostgreSQL Row Level Security, and workspace creation.
- Contact CRM with create/edit/delete, search, CSV import/export, consent fields, and activity logging.
- Team member invitations, role changes, and removals (Supabase Admin API and service-role key required).
- Job records and application-stage tracking.
- AI assistant, profile analysis, and outreach drafting through a server-side OpenAI API route, with atomic monthly usage quotas.
- Configurable licensed people-search, email-finder, and email-verification provider adapters. No third-party provider is impersonated and no fake search results are generated.
- Outreach templates, saved drafts, Resend delivery, marketing-consent checks, signed unsubscribe links, and one-click unsubscribe headers.
- Paystack recurring-plan checkout, webhook signature verification, and server-side subscription state updates.
- Workspace settings, provider readiness indicators, and a platform-admin metrics dashboard.
- GitHub Actions type-check and production-build workflow.

## Stack

Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL/RLS, Lucide icons, OpenAI API, Resend API, and Paystack API.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Create a Supabase project and configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
4. Apply every migration in order: `0001_initial_schema.sql` through `0005_platform_admin.sql`.
5. Configure the Supabase Auth email provider and redirect URL for your local/deployed app.
6. Run `npm install`, `npm run typecheck`, and `npm run dev`.
7. Open `http://localhost:3000`.

The public landing page can render without Supabase. Authenticated modules require a configured Supabase project and applied migrations; they are not simulated.

## Provider configuration

### AI
Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. The API key is read only by server routes. Monthly per-workspace quotas are enforced atomically in Postgres by `consume_feature_usage` (default limits: 20 free, 200 starter, 1,000 growth, 5,000 business units per feature).

### People search, email finder, and email verification

The application deliberately does not scrape LinkedIn or bypass third-party access controls. Connect a provider only when your organization has the right to use its data and the provider's contract permits your use case.

The server-side people-search adapter sends a POST request to `PEOPLE_SEARCH_API_URL` with:
```json
{ "query": "product designer", "filters": { "title": "", "company": "", "location": "Lagos" }, "limit": 25, "page": 1 }
```
It expects a JSON response containing `results` (or `data.results`) with fields such as `full_name`, `email`, `company`, `job_title`, `location`, `linkedin_url`, and `source`.

The email finder route accepts first name, last name, and company domain at `/api/email/find` and expects a JSON response with an email and confidence. The email verification adapter sends `{ "email": "person@example.com" }` and expects `status` or `result`, optionally `score` and `reason`. Configure provider URLs and API keys in server environment variables only; the URLs must use HTTPS.

### Email sending

Configure a verified sender with Resend, then set `RESEND_API_KEY`, `EMAIL_FROM`, and a random `UNSUBSCRIBE_SECRET` of at least 32 characters. The CRM defaults email marketing consent to false. Sending is blocked unless explicit opt-in is recorded and the contact has not unsubscribed. Drafts are human-reviewed; CSV import and saving a profile never imply consent.

### Paystack subscriptions

Create monthly plans in the Paystack Dashboard and configure their plan codes as `PAYSTACK_PLAN_STARTER_CODE`, `PAYSTACK_PLAN_GROWTH_CODE`, and `PAYSTACK_PLAN_BUSINESS_CODE`. Also set the matching `PAYSTACK_STARTER_AMOUNT_KOBO`, `PAYSTACK_GROWTH_AMOUNT_KOBO`, and `PAYSTACK_BUSINESS_AMOUNT_KOBO` values (in kobo; these should match the plan values). Set `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET`. Register `https://YOUR_DOMAIN/api/billing/webhook` as the Paystack webhook endpoint. Checkout and subscription activation are server-side; browser redirects alone do not activate a plan. Paystack plan billing is recurring according to the interval configured in Paystack.

### Platform administrator

After a user has registered, run this in the Supabase SQL editor with that user's exact account email:
```sql
insert into public.platform_admins(user_id)
select id from auth.users where email = 'ADMIN_EMAIL';
```
The admin dashboard is available at `/dashboard/admin`. Do not expose the service-role key to the browser.

## Scheduled operations

`CRON_SECRET` protects `GET /api/cron/outreach`. Configure a trusted scheduler to call that endpoint with `Authorization: Bearer <CRON_SECRET>` (for example, every 5 minutes). Add `APP_BASE_URL` and `CRON_SECRET` as GitHub Actions repository secrets to use the included scheduled workflow. Do not expose the cron secret as a public client environment variable.

## Security and production notes

- Service-role, OpenAI, email, and payment keys must remain server-side.
- RLS provides tenant boundaries; API routes also verify workspace membership and role.
- Only authorized/licensed data sources should be connected.
- Do not infer protected traits or use AI assessments as automated employment decisions.
- Review all generated text. Do not send bulk or marketing messages without a lawful basis, recorded consent, and working unsubscribe controls.
- Apply migrations in order and test them in a non-production Supabase project first.
- Configure backups, monitoring, rate limits, email sender authentication (SPF/DKIM/DMARC), privacy notices, retention/deletion workflows, and local legal review before production launch.

## Validation

Run `npm run typecheck` and `npm run build`. GitHub Actions runs both on pushes and pull requests to `main`. Provider integrations require real sandbox credentials and end-to-end tests before launch.

This is a substantial product implementation, but the repository should not be described as production-verified until the migrations are applied to a real Supabase project, provider credentials are supplied, CI is green, and the deployment and security checks are completed.
