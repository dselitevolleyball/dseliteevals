-- Product board live updates (Drew, Oct 28 2026: "make the product board live -
-- as things move from backlog to planned to building it auto updates without
-- refreshing").
--
-- Every change to a card, an agent run or a card's activity sends a Realtime
-- broadcast on the public "product-board" topic. It carries only the card id
-- and which table changed - the board then reloads through /api/product, so
-- nothing on the cards leaves the API and the tables keep their no-policy RLS.
-- Covers every writer: HQ, the agent's reports and Slack buttons/replies.

create or replace function public.product_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('item_id', case when tg_table_name = 'product_items' then r->'id' else r->'item_id' end, 'table', tg_table_name, 'op', tg_op),
      'change', 'product-board', false);
  exception when others then null;   -- a missed ping must never block a write
  end;
  return null;
end $$;

drop trigger if exists product_items_live on public.product_items;
create trigger product_items_live after insert or update or delete on public.product_items
  for each row execute function public.product_live();
drop trigger if exists product_runs_live on public.product_runs;
create trigger product_runs_live after insert or update or delete on public.product_runs
  for each row execute function public.product_live();
drop trigger if exists product_events_live on public.product_events;
create trigger product_events_live after insert or update or delete on public.product_events
  for each row execute function public.product_live();
