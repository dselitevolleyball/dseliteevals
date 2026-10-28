-- Product board (Drew, Oct 28 2026): a Linear-style board for HQ features.
-- Staff send ideas and bugs from the 💡 Feedback button anywhere in HQ; they
-- land in Inbox; an owner/admin approves (Backlog) or declines. Approved cards
-- can be handed to a coding agent (Claude Code in GitHub Actions) with a chosen
-- model and effort; it builds on a branch, opens a PR with a preview, takes
-- "make these changes" rounds, and ships when Drew says so.
-- Every Claude call HQ makes (and every agent run) is logged in ai_usage so
-- Product -> Usage shows tokens, cost and rate limits.
-- All reads and writes go through /api/product and /api/product-agent
-- (service role); RLS is on with no public policies.

create table if not exists public.product_items (
  id              bigserial primary key,
  title           text not null,
  body            text not null default '',          -- the description / spec the agent builds from
  kind            text not null default 'feature',   -- feature | improvement | bug
  status          text not null default 'inbox',     -- inbox | backlog | planned | building | review | shipped | declined | canceled
  priority        int  not null default 0,           -- 0 none, 1 urgent, 2 high, 3 medium, 4 low (Linear's order)
  area            text,                              -- DS Elite HQ, DSSC HQ, Marketing, Website...
  repo            text not null default 'dselitevolleyball/dseliteevals',
  labels          text[] not null default '{}',
  model           text not null default 'claude-opus-5-5',
  effort          text not null default 'high',      -- low | medium | high | xhigh | max
  max_turns       int  not null default 80,
  requested_by    text,                              -- email
  requested_name  text,
  request_context jsonb not null default '{}'::jsonb, -- { view, url, app, ua }
  screenshot_url  text,
  votes           text[] not null default '{}',      -- emails of staff who +1'd it
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  branch          text,
  pr_number       int,
  pr_url          text,
  preview_url     text,
  sort            double precision not null default 0,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists product_items_status_idx on public.product_items (status, sort);

create table if not exists public.product_events (
  id        bigserial primary key,
  item_id   bigint not null references public.product_items(id) on delete cascade,
  kind      text not null default 'comment',   -- comment | status | decision | run | system
  body      text not null default '',
  data      jsonb not null default '{}'::jsonb,
  by_email  text,
  by_name   text,
  at        timestamptz not null default now()
);
create index if not exists product_events_item_idx on public.product_events (item_id, at);

create table if not exists public.product_runs (
  id                bigserial primary key,
  item_id           bigint not null references public.product_items(id) on delete cascade,
  kind              text not null,                  -- build | revise | ship
  status            text not null default 'queued', -- queued | running | succeeded | failed | canceled
  model             text,
  effort            text,
  max_turns         int,
  instructions      text,                           -- the "make these changes" note for a revise
  repo              text,
  requested_by      text,
  dispatched_at     timestamptz,
  claimed_at        timestamptz,
  finished_at       timestamptz,
  github_run_url    text,
  branch            text,
  pr_number         int,
  pr_url            text,
  preview_url       text,
  cost_usd          numeric(12,4),
  input_tokens      bigint,
  output_tokens     bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  num_turns         int,
  duration_ms       bigint,
  summary           text,
  error             text,
  created_at        timestamptz not null default now()
);
create index if not exists product_runs_item_idx on public.product_runs (item_id, created_at desc);
create index if not exists product_runs_queue_idx on public.product_runs (status, repo, created_at);

-- One row per Claude API call (source 'hq') or agent run (source 'agent').
create table if not exists public.ai_usage (
  id                 bigserial primary key,
  at                 timestamptz not null default now(),
  source             text not null default 'hq',
  feature            text,
  model              text,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd           numeric(12,6) not null default 0,
  ms                 int,
  status             int,
  item_id            bigint,
  run_id             bigint
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);

-- Latest rate-limit headers Anthropic sent back, and HQ-held secrets (GitHub token).
create table if not exists public.hq_kv (
  key        text primary key,
  value      jsonb,
  secret     boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.product_items  enable row level security;
alter table public.product_events enable row level security;
alter table public.product_runs   enable row level security;
alter table public.ai_usage       enable row level security;
alter table public.hq_kv          enable row level security;

alter table public.product_items add column if not exists max_budget_usd numeric(8,2) not null default 10;
alter table public.product_runs  add column if not exists max_budget_usd numeric(8,2);
insert into storage.buckets (id, name, public) values ('product-media', 'product-media', false) on conflict (id) do nothing;

-- Usage dashboard totals (Product -> Usage), Central-time days.
create or replace function public.ai_usage_summary(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select * from ai_usage where at >= now() - make_interval(days => greatest(1, least(p_days, 400)))),
       m as (select * from ai_usage where at >= date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago')
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(d order by d->>'day') from (
        select jsonb_build_object('day', to_char(at at time zone 'America/Chicago', 'YYYY-MM-DD'),
          'cost', round(sum(cost_usd)::numeric, 4), 'calls', count(*),
          'hq', round(sum(cost_usd) filter (where source = 'hq')::numeric, 4), 'agent', round(sum(cost_usd) filter (where source = 'agent')::numeric, 4),
          'tokens', sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)) d
        from u group by to_char(at at time zone 'America/Chicago', 'YYYY-MM-DD')) x), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(f order by (f->>'cost')::numeric desc) from (
        select jsonb_build_object('feature', coalesce(feature, '(unnamed)'), 'source', source, 'calls', count(*), 'cost', round(sum(cost_usd)::numeric, 4),
          'input', sum(input_tokens), 'output', sum(output_tokens), 'cache_read', sum(cache_read_tokens), 'cache_write', sum(cache_write_tokens),
          'errors', count(*) filter (where status >= 400), 'avg_ms', round(avg(ms))) f
        from u group by feature, source) x), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(f order by (f->>'cost')::numeric desc) from (
        select jsonb_build_object('model', coalesce(model, '(failed call)'), 'calls', count(*), 'cost', round(sum(cost_usd)::numeric, 4),
          'input', sum(input_tokens), 'output', sum(output_tokens), 'cache_read', sum(cache_read_tokens), 'cache_write', sum(cache_write_tokens)) f
        from u group by model) x), '[]'::jsonb),
    'month', (select jsonb_build_object('cost', round(coalesce(sum(cost_usd), 0)::numeric, 4), 'calls', count(*),
          'agent_cost', round(coalesce(sum(cost_usd) filter (where source = 'agent'), 0)::numeric, 4),
          'tokens', coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)) from m),
    'period', (select jsonb_build_object('cost', round(coalesce(sum(cost_usd), 0)::numeric, 4), 'calls', count(*),
          'input', coalesce(sum(input_tokens), 0), 'output', coalesce(sum(output_tokens), 0), 'cache_read', coalesce(sum(cache_read_tokens), 0),
          'cache_write', coalesce(sum(cache_write_tokens), 0), 'errors', count(*) filter (where status >= 400)) from u)
  );
$$;
revoke all on function public.ai_usage_summary(int) from public, anon, authenticated;

-- Slack (Oct 28 2026): one thread per card, so a reply in it means that card.
create table if not exists public.product_slack_threads (
  item_id    bigint primary key references public.product_items(id) on delete cascade,
  channel    text not null,
  ts         text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists product_slack_threads_ts_idx on public.product_slack_threads (channel, ts);
alter table public.product_slack_threads enable row level security;
