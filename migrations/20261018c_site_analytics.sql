-- Website tracking, email sign-ups and monthly recommendations (Drew, Oct 18 2026: "include some tracking
-- software and monthly recommendations for updates to the site ... I also want to get more emails from
-- people learning about the club").
--   site_events   first-party, cookie-free analytics from dselitevolleyball.com (POST /api/site-track)
--   site_leads    "Get club news by email" sign-ups (POST /api/site-lead; unsubscribe at /api/site-unsubscribe)
--   site_reports  the monthly report + Claude's recommendations (cron /api/site-report, 1st of the month)
-- Run: node scripts/run-sql.mjs migrations/20261018c_site_analytics.sql
CREATE TABLE IF NOT EXISTS public.site_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type        TEXT NOT NULL CHECK (type IN ('view', 'click', 'scroll', 'signup', 'feedback')),
  path        TEXT NOT NULL,
  label       TEXT,          -- click: link text / destination; scroll: depth
  ref_host    TEXT,          -- referrer host (external only)
  utm_source  TEXT,
  utm_medium  TEXT,
  utm_campaign TEXT,
  visitor     TEXT,          -- random id kept in the visitor's browser (no cookie, no personal data)
  session     TEXT,
  device      TEXT,          -- mobile | tablet | desktop
  country     TEXT,
  region      TEXT
);
CREATE INDEX IF NOT EXISTS site_events_ts_idx ON public.site_events (ts DESC);
CREATE INDEX IF NOT EXISTS site_events_type_ts_idx ON public.site_events (type, ts DESC);

CREATE TABLE IF NOT EXISTS public.site_leads (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  first_name    TEXT,
  player_age    TEXT,        -- age group / grade the family picked (optional)
  interest      TEXT,        -- tryouts | training | general
  source_path   TEXT,
  utm_source    TEXT,
  ref_host      TEXT,
  unsub_token   UUID NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at TIMESTAMPTZ,
  welcomed_at   TIMESTAMPTZ,
  is_test       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.site_reports (
  id            BIGSERIAL PRIMARY KEY,
  month         TEXT NOT NULL UNIQUE,   -- 'YYYY-MM' the report covers
  stats         JSONB NOT NULL,
  recommendations TEXT,
  emailed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_events_admin_read ON public.site_events;
CREATE POLICY site_events_admin_read ON public.site_events FOR SELECT USING (public.is_admin_coach());
DROP POLICY IF EXISTS site_leads_admin_read ON public.site_leads;
CREATE POLICY site_leads_admin_read ON public.site_leads FOR SELECT USING (public.is_admin_coach());
DROP POLICY IF EXISTS site_reports_admin_read ON public.site_reports;
CREATE POLICY site_reports_admin_read ON public.site_reports FOR SELECT USING (public.is_admin_coach());
GRANT SELECT ON public.site_events, public.site_leads, public.site_reports TO authenticated;
GRANT ALL ON public.site_events, public.site_leads, public.site_reports TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.site_events_id_seq, public.site_leads_id_seq, public.site_reports_id_seq TO service_role;

-- One round trip for the HQ "Visitors" panel and the monthly report.
CREATE OR REPLACE FUNCTION public.site_stats(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH e AS (SELECT * FROM site_events WHERE ts >= p_from AND ts < p_to),
  v AS (SELECT * FROM e WHERE type = 'view')
  SELECT CASE WHEN NOT (coalesce(auth.role(), '') = 'service_role' OR public.is_admin_coach()) THEN NULL ELSE jsonb_build_object(
    'views', (SELECT count(*) FROM v),
    'visitors', (SELECT count(DISTINCT visitor) FROM v),
    'sessions', (SELECT count(DISTINCT session) FROM v),
    'pages_per_session', (SELECT round(count(*)::numeric / NULLIF(count(DISTINCT session), 0), 2) FROM v),
    'single_page_sessions', (SELECT count(*) FROM (SELECT session FROM v GROUP BY session HAVING count(*) = 1) s),
    'top_pages', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'views' DESC), '[]') FROM (SELECT jsonb_build_object('path', path, 'views', count(*), 'visitors', count(DISTINCT visitor)) x FROM v GROUP BY path ORDER BY count(*) DESC LIMIT 15) t),
    'entry_pages', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('path', path, 'sessions', count(*)) x FROM (SELECT DISTINCT ON (session) session, path FROM v ORDER BY session, ts) f GROUP BY path ORDER BY count(*) DESC LIMIT 10) t),
    'exit_pages', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('path', path, 'sessions', count(*)) x FROM (SELECT DISTINCT ON (session) session, path FROM v ORDER BY session, ts DESC) f GROUP BY path ORDER BY count(*) DESC LIMIT 10) t),
    'referrers', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('source', coalesce(utm_source, ref_host, '(direct)'), 'visitors', count(DISTINCT visitor)) x FROM v GROUP BY coalesce(utm_source, ref_host, '(direct)') ORDER BY count(DISTINCT visitor) DESC LIMIT 12) t),
    'devices', (SELECT coalesce(jsonb_object_agg(device, n), '{}') FROM (SELECT coalesce(device, 'unknown') device, count(DISTINCT visitor) n FROM v GROUP BY 1) t),
    'regions', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('region', coalesce(region, '?') || ', ' || coalesce(country, '?'), 'visitors', count(DISTINCT visitor)) x FROM v GROUP BY region, country ORDER BY count(DISTINCT visitor) DESC LIMIT 8) t),
    'clicks', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('label', label, 'path', path, 'clicks', count(*)) x FROM e WHERE type = 'click' GROUP BY label, path ORDER BY count(*) DESC LIMIT 25) t),
    'scroll_75', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('path', s.path, 'reached', count(DISTINCT s.session), 'sessions', (SELECT count(DISTINCT session) FROM v WHERE v.path = s.path)) x FROM e s WHERE s.type = 'scroll' GROUP BY s.path ORDER BY count(DISTINCT s.session) DESC LIMIT 15) t),
    'signups', (SELECT count(*) FROM site_leads WHERE created_at >= p_from AND created_at < p_to AND NOT is_test),
    'signups_by_page', (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT jsonb_build_object('path', coalesce(source_path, '?'), 'signups', count(*)) x FROM site_leads WHERE created_at >= p_from AND created_at < p_to AND NOT is_test GROUP BY source_path ORDER BY count(*) DESC) t),
    'list_size', (SELECT count(*) FROM site_leads WHERE unsubscribed_at IS NULL AND NOT is_test),
    'feedback', (SELECT jsonb_build_object('count', count(*), 'avg', round(avg(rating), 2),
        'comments', coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'page', page, 'navigation', navigation, 'needs_help', needs_help)) FILTER (WHERE navigation IS NOT NULL OR needs_help IS NOT NULL), '[]'))
      FROM site_feedback WHERE created_at >= p_from AND created_at < p_to AND NOT is_test)
  ) END;
$$;
REVOKE ALL ON FUNCTION public.site_stats(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_stats(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
SELECT 'ok' AS done;
