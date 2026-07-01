-- 20260701 — Fix: deleting a player fails with
--   insert or update on table "change_log" violates foreign key constraint
--   "change_log_player_id_fkey"
--
-- Cause: the players_audit trigger fires AFTER DELETE and inserts a change_log
-- row with player_id = OLD.id — but the player row is already gone, so the FK
-- (player_id REFERENCES players(id)) rejects the insert.
--
-- Fix: log deletes with player_id = NULL. The deleted player's full record
-- (including id + name) is still captured in field_changes, so the audit trail
-- is preserved. Only the DELETE branch changed vs the original function.
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run.

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
    -- player_id must be NULL here: the row is already deleted, so referencing
    -- OLD.id would violate change_log_player_id_fkey. Identity is kept in field_changes.
    INSERT INTO public.change_log (player_id, table_name, action, field_changes, actor_id, actor_email, actor_name)
    VALUES (NULL, 'players', 'delete', to_jsonb(OLD), auth.uid(), v_actor_email, v_actor_name);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
