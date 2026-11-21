alter table public.subscriptions
  add column if not exists provider_subscription_code text,
  add column if not exists provider_customer_code text,
  add column if not exists cancel_at_period_end boolean not null default false;
create unique index if not exists subscriptions_provider_subscription_code_uidx
  on public.subscriptions(provider_subscription_code) where provider_subscription_code is not null;
