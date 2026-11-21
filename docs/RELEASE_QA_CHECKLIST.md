# Release QA and setup checklist

This checklist distinguishes repository code from external services that still need real credentials and verification.

## 1. Supabase project

- [ ] Create a non-production Supabase project for initial validation.
- [ ] Add the project URL, anon key, and server-only service-role key to local/deployment environment variables.
- [ ] Apply migrations 0001 through 0013 in lexical order.
- [ ] Configure Auth email confirmation, SMTP/email delivery, allowed redirect URLs, and the production site URL.
- [ ] Register two test users and create two separate workspaces.
- [ ] Confirm a user cannot read the other workspace's contacts, jobs, applications, activities, campaigns, settings, or usage rows.
- [ ] Confirm an owner/admin can invite members; a regular member cannot write membership rows or promote their own role.
- [ ] Confirm the last workspace owner cannot be removed or demoted.
- [ ] Confirm a viewer can read tenant data but cannot create, update, or delete CRM/job records.
- [ ] Confirm tenant ownership fields are immutable and application/job workspace constraints reject cross-workspace references.
- [ ] Confirm subscriptions are visible only to workspace owners/admins.
- [ ] Confirm direct workspace table inserts are rejected and the create_workspace RPC succeeds.

## 2. CRM and consent

- [ ] Create, edit, search, and delete contacts with each permitted role.
- [ ] Import CSV containing quoted commas, quotes, and line breaks; confirm imported emails have no marketing opt-in.
- [ ] Export the CRM to CSV and a full workspace JSON archive.
- [ ] Confirm marketing opt-in cannot be saved without a consent evidence note.
- [ ] Confirm re-consent records a fresh timestamp and clears a previous unsubscribe state.
- [ ] Confirm unsubscribe turns opt-in off and cannot be overridden by a saved draft or queued campaign.

## 3. Licensed data providers

- [ ] Connect providers whose licences and terms authorize the intended people-search and job-search use cases.
- [ ] Map its response into the documented results/data.results contract.
- [ ] Test empty results, provider errors, timeouts, rate limits, malformed responses, and HTTPS enforcement.
- [ ] Test job-search, email-finder, and email-verification adapters separately.
- [ ] Confirm saving search results never sets email marketing consent.
- [ ] Confirm no restricted-platform scraping, access-control bypass, or unauthorized bulk export is enabled.

## 4. AI

- [ ] Set OPENAI_API_KEY and a supported OPENAI_MODEL as server-side variables only.
- [ ] Test assistant, profile analysis, outreach drafting, and job-match tasks with synthetic or authorized data.
- [ ] Confirm prompts do not infer protected characteristics or make automated hiring recommendations.
- [ ] Confirm usage increments atomically, free limits are enforced, paid limits require an active subscription, and provider failures are observable.\n- [ ] Confirm `/dashboard/usage` displays counts consistent with the usage counters and feature quotas.
- [ ] Review output quality and hallucination risk with human reviewers before real recruiting use.

## 5. Email and campaigns

- [ ] Verify the sending domain in Resend and configure SPF, DKIM, and DMARC.
- [ ] Set RESEND_API_KEY, EMAIL_FROM, UNSUBSCRIBE_SECRET (32+ random characters), and NEXT_PUBLIC_APP_URL.
- [ ] Use only test contacts with documented opt-in.
- [ ] Send one direct draft and one scheduled campaign to controlled test inboxes.
- [ ] Confirm drafts remain unsent until a human clicks Send or schedules a campaign.
- [ ] Confirm no-consent, missing-email, and unsubscribed contacts are blocked/skipped at send time.
- [ ] Test unsubscribe confirmation and RFC 8058 one-click POST handling.
- [ ] Confirm send quotas, pauses on quota exhaustion, admin resume, worker retries, idempotency behavior, and month-boundary quota reset.
- [ ] Add APP_BASE_URL and a 32+ character CRON_SECRET to GitHub Actions secrets for the scheduled outreach workflow.
- [ ] Confirm the scheduled worker runs every five minutes and reports sent, failed, skipped, and quota-blocked counts.
- [ ] Test delivery failures, provider timeouts, stale sending recovery, cancellation, and campaign completion status.

## 6. Paystack billing

- [ ] Create and test Starter, Growth, and Business recurring plans in Paystack (matching intervals and amounts).
- [ ] Configure plan codes and matching amounts in kobo; configure API secret and modern webhook signing secret.
- [ ] Register /api/billing/webhook and enable charge.success, subscription.create, invoice.payment_failed, invoice.update, subscription.not_renew, and subscription.disable events.
- [ ] Test successful checkout, failed charge, renewal, payment failure, cancellation at period end, and disabled subscription.
- [ ] Confirm browser return URLs never activate a subscription on their own.
- [ ] Confirm inactive, cancelled, and past-due plans fall back to free quotas.
- [ ] Confirm the workspace owner can open the hosted subscription management page.

## 7. Platform administration and launch

- [ ] Bootstrap the first platform administrator through the documented Supabase SQL statement.
- [ ] Verify non-admin users receive HTTP 403 on /api/admin/overview.
- [ ] Confirm super-admin metrics are aggregate-only.
- [ ] Run npm run typecheck and npm run build.
- [ ] Confirm GitHub Actions CI succeeds on the target commit.
- [ ] Deploy to the production host and configure all secrets in its environment dashboard.
- [ ] Configure backups, monitoring, error alerts, log retention, privacy notice, data retention policy, and incident response.
- [ ] Perform a tenant-isolation/security review before storing real personal data.
- [ ] Obtain local legal/privacy review for recruiting decisions, candidate data, marketing consent, retention, and cross-border processing.

## Current limitations

- Search, email finder, and email verification are provider adapters; inactive until compatible licensed provider credentials are supplied.
- Automated job-board discovery is not enabled; jobs are saved manually from authorized listings.
- Payments use Paystack only; Stripe is not integrated.
- Email delivery uses Resend only; Gmail/Microsoft OAuth sending is not integrated.
- The repository has not been verified against a live Supabase project or provider sandbox credentials.