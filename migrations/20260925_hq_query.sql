-- Migration: read-only SQL for the in-app assistant ("Ask HQ").
-- Date: 2026-09-25  Idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260925_hq_query.sql
--
-- The assistant answers admins' questions by writing SELECTs against the
-- database. Supabase's REST API can't run arbitrary SQL, so this function
-- does — under three locks: only a single SELECT/WITH statement, a read-only
-- transaction (any write attempt fails), and an 8-second timeout. It is
-- SECURITY DEFINER and callable only by the service role (the API endpoint),
-- never by the browser.

CREATE OR REPLACE FUNCTION public.hq_query(sql text, max_rows int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q      text := rtrim(btrim(sql), ';');
  result jsonb;
BEGIN
  IF q !~* '^(select|with)\s' THEN
    RAISE EXCEPTION 'hq_query is read-only: the statement must start with SELECT or WITH';
  END IF;
  IF position(';' IN q) > 0 THEN
    RAISE EXCEPTION 'hq_query runs one statement at a time';
  END IF;
  IF q ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|pg_sleep|dblink|set\s+role)\M' THEN
    RAISE EXCEPTION 'hq_query is read-only';
  END IF;
  PERFORM set_config('transaction_read_only', 'on', true);
  PERFORM set_config('statement_timeout', '8000', true);
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) s LIMIT %s) t', q, GREATEST(1, LEAST(max_rows, 500)))
    INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.hq_query(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hq_query(text, int) FROM anon;
REVOKE ALL ON FUNCTION public.hq_query(text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hq_query(text, int) TO service_role;

-- What the assistant said and did, so an admin can see the trail and Drew
-- can tune the prompt from real questions.
CREATE TABLE IF NOT EXISTS public.hq_assistant_log (
  id           BIGSERIAL PRIMARY KEY,
  asked_by     TEXT,
  question     TEXT,
  answer       TEXT,
  tool_calls   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, input, ms, rows|error}]
  view         TEXT,
  input_tokens INT,
  output_tokens INT,
  ms           INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.hq_assistant_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_hq_assistant_log" ON public.hq_assistant_log;
CREATE POLICY "auth_read_hq_assistant_log" ON public.hq_assistant_log FOR SELECT USING (auth.uid() IS NOT NULL);
