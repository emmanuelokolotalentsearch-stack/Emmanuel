# AI Workforce Search

AI-powered prospecting, recruitment CRM, and career search SaaS.

## Project status

Repository initialized. Phase 1 implementation is next: application foundation, authentication, multi-tenant data model, workspace roles, and administrator/business dashboards.

## Planned stack

- Next.js App Router, React, TypeScript
- Tailwind CSS and shadcn/ui
- Supabase Auth and PostgreSQL with Row Level Security
- OpenAI API through server-side routes
- Resend for authorized email delivery
- Paystack and Stripe through server-side payment adapters

## Development principles

- No fabricated professional/contact/job data.
- No unauthorized scraping or access-control bypasses.
- Enforce tenant isolation and plan limits on the server and in PostgreSQL.
- Keep provider integrations explicitly unconfigured until credentials are supplied and tested.
- Never commit secrets; use environment variables.

## Local setup

Setup instructions will be added as the application foundation is committed.
