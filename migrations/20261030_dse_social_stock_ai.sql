-- Claude's read of each stock photo (Drew, Oct 30 2026: "an ai analysis of the
-- photo to use when creating social media posts and choosing pictures for the
-- website"). ai = { description, alt, setting, subject, people, tags, quality,
-- social_ok, social_concern, social_score, website_score, website_role,
-- focal_x, focal_y, text_space, best_for, dse_gear }. website = Drew picked it
-- for dselitevolleyball.com; /api/site-photos lists those for the website's
-- scripts/pull-stock-photos.mjs.
alter table public.dse_social_stock add column if not exists ai jsonb;
alter table public.dse_social_stock add column if not exists ai_at timestamptz;
alter table public.dse_social_stock add column if not exists ai_error text;
alter table public.dse_social_stock add column if not exists website boolean not null default false;
alter table public.dse_social_stock add column if not exists website_at timestamptz;
