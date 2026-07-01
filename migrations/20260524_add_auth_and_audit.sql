-- Migration: per-coach Supabase Auth + change-log audit triggers
-- Date: 2026-05-24
--
-- BEFORE RUNNING:
--   1. In Supabase Dashboard -> Authentication -> Providers, make sure the
--      "Email" provider is enabled (it is by default).
--   2. (Optional but recommended for v1) Authentication -> Providers -> Email
--      -> "Confirm email" -> OFF, so coaches can sign in immediately after
--      signup instead of waiting for a confirmation email. You can turn this
--      back on later.
--   3. Disable public sign-ups if you don't want randoms creating accounts:
--      Authentication -> Sign In / Up -> "Allow new users to sign up" -> ON
--      for now (we need it for bootstrap); turn OFF after your admin is set up.
--
-- AFTER RUNNING:
--   The very FIRST signup is auto-promoted to admin + approved via the
--   handle_new_user trigger. Sign up immediately after deploying the new
--   frontend to claim that slot. Every subsequent coach must be approved by
--   an existing admin via the new "Coaches" tab.
--
-- IF YOU GET LOCKED OUT (e.g. you accidentally removed your own admin flag):
--   Run this in the Supabase SQL editor as the service role:
--     UPDATE public.coaches SET is_admin = TRUE, is_approved = TRUE
--      WHERE email = 'your@email.com';

-- ───── 1. coaches profile table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coaches (
  id            UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT         NOT NULL,
  display_name  TEXT         NOT NULL DEFAULT '',
  is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_approved   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS coaches_email_idx ON public.coaches (email);

ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coaches_select_authenticated ON public.coaches;
CREATE POLICY coaches_select_authenticated ON public.coaches
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS coaches_update_self_or_admin ON public.coaches;
CREATE POLICY coaches_update_self_or_admin ON public.coaches
  FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin)
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin)
  );

DROP POLICY IF EXISTS coaches_delete_admin ON public.coaches;
CREATE POLICY coaches_delete_admin ON public.coaches
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));

-- Auto-create a coaches row when someone signs up via Supabase Auth.
-- The FIRST signup is auto-promoted to admin + approved so there's always
-- a way back in.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;
  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_first,
    v_first
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ───── 2. change_log table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.change_log (
  id             BIGSERIAL    PRIMARY KEY,
  player_id      INTEGER      REFERENCES public.players(id) ON DELETE SET NULL,
  table_name     TEXT         NOT NULL DEFAULT 'players',
  action         TEXT         NOT NULL,        -- 'insert' / 'update' / 'delete'
  field_changes  JSONB,                        -- {field: {old, new}} for updates; full row for insert/delete
  actor_id       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email    TEXT,                          -- denormalized so log survives coach deletion
  actor_name     TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS change_log_created_at_idx ON public.change_log (created_at DESC);
CREATE INDEX IF NOT EXISTS change_log_player_id_idx  ON public.change_log (player_id);
CREATE INDEX IF NOT EXISTS change_log_actor_id_idx   ON public.change_log (actor_id);

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS change_log_select_approved ON public.change_log;
CREATE POLICY change_log_select_approved ON public.change_log
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Inserts come from the SECURITY DEFINER trigger below (which bypasses RLS),
-- but we add a permissive INSERT policy as a fallback in case the app ever
-- wants to log a non-trigger event from the client.
DROP POLICY IF EXISTS change_log_insert_approved ON public.change_log;
CREATE POLICY change_log_insert_approved ON public.change_log
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- ───── 3. Audit trigger on players ───────────────────────────────────
-- Captures the actor (auth.uid() lookup -> coaches) and a compact field-level
-- diff for updates (only fields whose value actually changed). For insert /
-- delete, stores the full row JSON.
CREATE OR REPLACE FUNCTION public.log_players_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email TEXT;
  v_actor_name  TEXT;
  v_changes     JSONB := '{}'::jsonb;
  v_key         TEXT;
  v_old_jsonb   JSONB;
  v_new_jsonb   JSONB;
BEGIN
  SELECT email, COALESCE(NULLIF(display_name, ''), email)
    INTO v_actor_email, v_actor_name
    FROM public.coaches WHERE id = auth.uid();

  IF TG_OP = 'UPDATE' THEN
    v_old_jsonb := to_jsonb(OLD);
    v_new_jsonb := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new_jsonb)
    LOOP
      IF v_key NOT IN ('updated_at') AND
         (v_new_jsonb -> v_key) IS DISTINCT FROM (v_old_jsonb -> v_key)
      THEN
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old_jsonb -> v_key, 'new', v_new_jsonb -> v_key)
        );
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW; -- nothing meaningful changed
    END IF;
    INSERT INTO public.change_log (player_id, table_name, action, field_changes, actor_id, actor_email, actor_name)
    VALUES (NEW.id, 'players', 'update', v_changes, auth.uid(), v_actor_email, v_actor_name);

  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.change_log (player_id, table_name, action, field_changes, actor_id, actor_email, actor_name)
    VALUES (NEW.id, 'players', 'insert', to_jsonb(NEW), auth.uid(), v_actor_email, v_actor_name);

  ELSIF TG_OP = 'DELETE' THEN
    -- player_id must be NULL: the row is already deleted (AFTER DELETE), so
    -- referencing OLD.id would violate change_log_player_id_fkey. The deleted
    -- player's full record is preserved in field_changes.
    INSERT INTO public.change_log (player_id, table_name, action, field_changes, actor_id, actor_email, actor_name)
    VALUES (NULL, 'players', 'delete', to_jsonb(OLD), auth.uid(), v_actor_email, v_actor_name);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS players_audit ON public.players;
CREATE TRIGGER players_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.log_players_change();

-- ───── 4. Lock down players RLS to approved coaches ───────────────────
-- WAS: a single "Allow all access" policy from the original schema, which let
-- anyone with the anon key read/write. NOW: only approved coaches.
DROP POLICY IF EXISTS "Allow all access" ON public.players;
DROP POLICY IF EXISTS players_all_approved ON public.players;
CREATE POLICY players_all_approved ON public.players
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Note: unassigned_rankings RLS is intentionally NOT changed here. If you
-- want to lock that down too, run a follow-up migration after verifying
-- the auth flow works end-to-end.
