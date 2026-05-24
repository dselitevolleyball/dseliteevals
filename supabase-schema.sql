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

-- Allow all operations with the anon key (simple setup - no auth required)
CREATE POLICY "Allow all access" ON players
  FOR ALL USING (true) WITH CHECK (true);

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
