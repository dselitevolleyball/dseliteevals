-- Marketing weeks run Tuesday through the next Monday (Drew, Oct 28 2026:
-- Jonathan reviews on Mondays and kicks the week off on Tuesday).
-- mkt_items.week_of becomes the Tuesday that starts the item's week, from its
-- Central-time day (unscheduled items: the Tuesday after their old Monday).
update mkt_items set week_of = case
  when scheduled_at is null then week_of + 1
  else (scheduled_at at time zone 'America/Chicago')::date
       - ((extract(dow from (scheduled_at at time zone 'America/Chicago'))::int - 2 + 7) % 7)
end;

-- The weekly email kicks the week off on Tuesday (it was Monday's job).
update mkt_settings set cadence = jsonb_set(cadence, '{email,day}', '"tue"') where id = 1 and cadence->'email'->>'day' = 'mon';
