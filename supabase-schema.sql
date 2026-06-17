-- DS Elite Tryout Evaluations - Supabase Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)

-- Players table - stores all registration and evaluation data
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  age TEXT,
  dob TEXT,
  reg_group TEXT,
  usav_div TEXT,
  reg_position TEXT,
  min_level TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,
  city TEXT,
  strength_weakness TEXT,
  goal TEXT,
  starter_pref TEXT,
  ideal_coach TEXT,
  leaving_reason TEXT,
  supplemental INTEGER DEFAULT 0,
  -- Evaluation fields (editable by coaches)
  scores JSONB DEFAULT '{}',
  notes TEXT DEFAULT '',
  comments TEXT DEFAULT '',
  team_assignment TEXT DEFAULT '',
  eval_complete BOOLEAN DEFAULT FALSE,
  tryout_number TEXT DEFAULT '',
  stand_reach NUMERIC,                 -- standing reach (inches); see migrations/20260617
  jump_touch NUMERIC,                  -- jump touch (inches)
  tryout_attended BOOLEAN NOT NULL DEFAULT FALSE,  -- tryout attendance checkbox
  positions TEXT[] DEFAULT '{}',
  projected_team TEXT DEFAULT '',
  current_team TEXT DEFAULT '',
  eval_dates TEXT[] DEFAULT '{}',
  roster_pos TEXT DEFAULT '',
  id_clinic_invited BOOLEAN NOT NULL DEFAULT FALSE,
  id_clinic_attended BOOLEAN NOT NULL DEFAULT FALSE,
  feedback_session_complete BOOLEAN NOT NULL DEFAULT FALSE,
  parent_feedback_notes TEXT NOT NULL DEFAULT '',
  parent_summary TEXT NOT NULL DEFAULT '',
  parent_summary_updated_at TIMESTAMPTZ,
  offer_status TEXT NOT NULL DEFAULT '',
  offer_made_at TIMESTAMPTZ,
  offer_decision_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Approved-coach access only (replaces the legacy "Allow all access" policy
-- as of the 20260524 auth migration).
CREATE POLICY players_all_approved ON players
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create index for faster queries
CREATE INDEX idx_players_usav_div ON players(usav_div);
CREATE INDEX idx_players_team ON players(team_assignment);

-- ───── Coaches profile table (added 20260524) ────────────────────────
-- One row per Supabase Auth user; auto-created by the on_auth_user_created
-- trigger. First signup is auto-promoted to admin + approved.
CREATE TABLE coaches (
  id            UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT         NOT NULL,
  display_name  TEXT         NOT NULL DEFAULT '',
  is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_approved   BOOLEAN      NOT NULL DEFAULT FALSE,
  can_view_teams BOOLEAN     NOT NULL DEFAULT FALSE,  -- gates the Teams tab; managed in the Coaches screen (see migrations/20260616)
  team_divs     TEXT[]       NOT NULL DEFAULT '{}',   -- allowed age groups (empty = all); scopes Evaluate/Teams/Rankings (see migrations/20260616)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX coaches_email_idx ON coaches (email);
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
CREATE POLICY coaches_select_authenticated ON coaches
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY coaches_update_self_or_admin ON coaches
  FOR UPDATE
  USING      (auth.uid() = id OR EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (auth.uid() = id OR EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_admin));
CREATE POLICY coaches_delete_admin ON coaches
  FOR DELETE USING (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_admin));

-- ───── Audit log (added 20260524) ────────────────────────────────────
-- Populated by an AFTER trigger on players that captures the actor (from the
-- coaches table via auth.uid()) and a field-level diff of the change.
CREATE TABLE change_log (
  id             BIGSERIAL    PRIMARY KEY,
  player_id      INTEGER      REFERENCES players(id) ON DELETE SET NULL,
  table_name     TEXT         NOT NULL DEFAULT 'players',
  action         TEXT         NOT NULL,
  field_changes  JSONB,
  actor_id       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email    TEXT,
  actor_name     TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX change_log_created_at_idx ON change_log (created_at DESC);
CREATE INDEX change_log_player_id_idx  ON change_log (player_id);
CREATE INDEX change_log_actor_id_idx   ON change_log (actor_id);
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_log_select_approved ON change_log
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE POLICY change_log_insert_approved ON change_log
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- ───── Signup allowlist (added 20260524) ─────────────────────────────
-- Only emails in this table can create an account; enforced server-side by
-- the handle_new_user trigger and pre-checked client-side via the
-- is_signup_allowed(text) RPC.
CREATE TABLE allowed_signup_emails (
  email          TEXT         PRIMARY KEY,
  added_by       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by_name  TEXT,
  added_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  note           TEXT
);
ALTER TABLE allowed_signup_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY allowed_emails_select_approved ON allowed_signup_emails
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE POLICY allowed_emails_insert_admin ON allowed_signup_emails
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_admin));
CREATE POLICY allowed_emails_delete_admin ON allowed_signup_emails
  FOR DELETE USING (EXISTS (SELECT 1 FROM coaches c WHERE c.id = auth.uid() AND c.is_admin));
