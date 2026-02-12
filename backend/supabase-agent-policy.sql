-- Agent policy controls + policy decision audit logs
-- Safe to re-run (uses IF NOT EXISTS guards).

create table if not exists public.agent_policies (
  agent_id text primary key,
  frozen boolean not null default false,
  daily_limit_usd numeric(18,6) not null default 1.000000,
  per_call_limit_usd numeric(18,6) not null default 0.050000,
  allowed_endpoints text[] not null default '{}',
  allowed_pay_to text[] not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_decision_logs (
  id uuid primary key,
  trace_id text,
  session_id uuid,
  agent_id text not null,
  endpoint text not null,
  quoted_price_usd numeric(18,6) not null default 0,
  decision text not null check (decision in ('allow', 'deny')),
  reason text not null,
  spent_today_usd numeric(18,6) not null default 0,
  reserved_usd numeric(18,6) not null default 0,
  remaining_daily_usd numeric(18,6) not null default 0,
  budget_before_usd numeric(18,6),
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_decision_logs_agent_created
  on public.policy_decision_logs (agent_id, created_at desc);

create index if not exists idx_policy_decision_logs_trace
  on public.policy_decision_logs (trace_id);

-- Optional: open access policies for development/testing.
-- If you already manage RLS differently, skip this section.
alter table public.agent_policies enable row level security;
alter table public.policy_decision_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_policies' and policyname = 'Allow all on agent_policies'
  ) then
    create policy "Allow all on agent_policies"
      on public.agent_policies
      for all
      using (true)
      with check (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'policy_decision_logs' and policyname = 'Allow all on policy_decision_logs'
  ) then
    create policy "Allow all on policy_decision_logs"
      on public.policy_decision_logs
      for all
      using (true)
      with check (true);
  end if;
end
$$;
