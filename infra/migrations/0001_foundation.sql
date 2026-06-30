-- Mnemosyne Engine foundation schema.
-- Canonical state lives in Postgres; graph/vector/search stores can be added as projections.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  privacy_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  social_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_session_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  accessibility_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  modality_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  target_concept_ids TEXT[] NOT NULL DEFAULT '{}',
  target_domain_ids TEXT[] NOT NULL DEFAULT '{}',
  priority NUMERIC NOT NULL CHECK (priority >= 0 AND priority <= 1),
  deadline TIMESTAMPTZ,
  intensity TEXT NOT NULL,
  desired_modalities TEXT[] NOT NULL DEFAULT '{}',
  avoid_modalities TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE readiness_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sleep_quality NUMERIC NOT NULL CHECK (sleep_quality >= 0 AND sleep_quality <= 1),
  fatigue NUMERIC NOT NULL CHECK (fatigue >= 0 AND fatigue <= 1),
  stress NUMERIC NOT NULL CHECK (stress >= 0 AND stress <= 1),
  available_minutes_morning INTEGER NOT NULL CHECK (available_minutes_morning > 0),
  available_minutes_evening INTEGER NOT NULL CHECK (available_minutes_evening > 0),
  screen_budget_minutes INTEGER NOT NULL CHECK (screen_budget_minutes >= 0),
  voice_ok BOOLEAN NOT NULL,
  dusk_mode BOOLEAN NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  citation TEXT,
  source_type TEXT NOT NULL,
  quality_score NUMERIC NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  subdomain TEXT,
  concept_type TEXT NOT NULL,
  claim_ids TEXT[] NOT NULL DEFAULT '{}',
  difficulty NUMERIC NOT NULL CHECK (difficulty >= 0 AND difficulty <= 1),
  importance NUMERIC NOT NULL CHECK (importance >= 0 AND importance <= 1),
  abstraction_level NUMERIC NOT NULL CHECK (abstraction_level >= 0 AND abstraction_level <= 1),
  volatility NUMERIC NOT NULL CHECK (volatility >= 0 AND volatility <= 1),
  definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanations JSONB NOT NULL DEFAULT '[]'::jsonb,
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  counterexamples JSONB NOT NULL DEFAULT '[]'::jsonb,
  misconceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  haptic_cues JSONB NOT NULL DEFAULT '[]'::jsonb,
  visual_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_assets TEXT[] NOT NULL DEFAULT '{}',
  learning_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  predicate_id TEXT NOT NULL,
  object_value JSONB NOT NULL,
  qualifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  epistemic_status TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  controversy_score NUMERIC NOT NULL CHECK (controversy_score >= 0 AND controversy_score <= 1),
  freshness_score NUMERIC NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  source_quality_score NUMERIC NOT NULL CHECK (source_quality_score >= 0 AND source_quality_score <= 1),
  last_reviewed_at TIMESTAMPTZ NOT NULL,
  review_after TIMESTAMPTZ,
  graph_version_introduced TEXT NOT NULL,
  graph_version_deprecated TEXT,
  arbiter_verdict_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE concept_edges (
  from_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  strength NUMERIC NOT NULL CHECK (strength >= 0 AND strength <= 1),
  confidence NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_outcome_support JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  arbiter_verdict_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  external_url TEXT,
  embed_url TEXT,
  embeddable BOOLEAN NOT NULL,
  title TEXT NOT NULL,
  creator TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  transcript_id TEXT,
  chapter_map JSONB NOT NULL DEFAULT '[]'::jsonb,
  concept_ids TEXT[] NOT NULL DEFAULT '{}',
  prerequisite_concept_ids TEXT[] NOT NULL DEFAULT '{}',
  horizon_concept_ids TEXT[] NOT NULL DEFAULT '{}',
  video_type TEXT NOT NULL,
  scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sleep_cues (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  cue_type TEXT NOT NULL,
  text TEXT,
  audio_asset_id TEXT,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  recommended_volume_db NUMERIC,
  cue_specificity NUMERIC NOT NULL CHECK (cue_specificity >= 0 AND cue_specificity <= 1),
  cross_talk_risk NUMERIC NOT NULL CHECK (cross_talk_risk >= 0 AND cross_talk_risk <= 1),
  sleep_safety_score NUMERIC NOT NULL CHECK (sleep_safety_score >= 0 AND sleep_safety_score <= 1),
  emotional_activation_score NUMERIC NOT NULL CHECK (
    emotional_activation_score >= 0
    AND emotional_activation_score <= 1
  ),
  eligible_sleep_stages TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE paced_read_assets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_id TEXT NOT NULL,
  concept_ids TEXT[] NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  recommended_wpm INTEGER NOT NULL CHECK (recommended_wpm > 0),
  cognitive_load_score NUMERIC NOT NULL CHECK (cognitive_load_score >= 0 AND cognitive_load_score <= 1),
  comprehension_gate TEXT NOT NULL
);

CREATE TABLE user_concept_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mastery NUMERIC NOT NULL CHECK (mastery >= 0 AND mastery <= 1),
  recall_strength NUMERIC NOT NULL CHECK (recall_strength >= 0 AND recall_strength <= 1),
  recall_stability NUMERIC NOT NULL CHECK (recall_stability >= 0 AND recall_stability <= 1),
  transfer_score NUMERIC NOT NULL CHECK (transfer_score >= 0 AND transfer_score <= 1),
  answer_latency_ms INTEGER,
  confidence_calibration NUMERIC NOT NULL CHECK (
    confidence_calibration >= 0
    AND confidence_calibration <= 1
  ),
  false_confidence_risk NUMERIC NOT NULL CHECK (
    false_confidence_risk >= 0
    AND false_confidence_risk <= 1
  ),
  prerequisite_health NUMERIC NOT NULL CHECK (prerequisite_health >= 0 AND prerequisite_health <= 1),
  failure_modes TEXT[] NOT NULL DEFAULT '{}',
  misconception_ids TEXT[] NOT NULL DEFAULT '{}',
  last_seen_at TIMESTAMPTZ,
  last_correct_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  times_seen INTEGER NOT NULL DEFAULT 0,
  times_recalled INTEGER NOT NULL DEFAULT 0,
  times_failed INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  sleep_replays INTEGER NOT NULL DEFAULT 0,
  cue_gain_estimate NUMERIC NOT NULL CHECK (cue_gain_estimate >= -1 AND cue_gain_estimate <= 1),
  best_cue_type TEXT,
  modality_response_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE daily_learning_packets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_date DATE NOT NULL,
  packet JSONB NOT NULL,
  audio_plan_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, packet_date)
);

CREATE TABLE sleep_cue_packets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  night_date DATE NOT NULL,
  packet JSONB NOT NULL,
  audio_plan_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, night_date)
);

CREATE TABLE audio_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  rendered_asset_id TEXT,
  render_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_packet_id TEXT REFERENCES daily_learning_packets(id) ON DELETE SET NULL,
  session_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  event_ids TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE assessment_responses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_item_id TEXT NOT NULL,
  response JSONB NOT NULL,
  correctness_score NUMERIC NOT NULL CHECK (correctness_score >= 0 AND correctness_score <= 1),
  semantic_score NUMERIC NOT NULL CHECK (semantic_score >= 0 AND semantic_score <= 1),
  confidence_reported NUMERIC CHECK (confidence_reported >= 0 AND confidence_reported <= 1),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE learning_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  proposer_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  affected_object_ids TEXT[] NOT NULL DEFAULT '{}',
  diff JSONB NOT NULL,
  rationale TEXT NOT NULL,
  evidence_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_against JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_learning_impact TEXT,
  risk_level TEXT NOT NULL,
  community_votes JSONB NOT NULL DEFAULT '{}'::jsonb,
  expert_comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_review JSONB,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE creator_ingestions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  license TEXT NOT NULL,
  notes TEXT,
  source JSONB,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  content JSONB NOT NULL,
  risk_flags TEXT[] NOT NULL DEFAULT '{}',
  proposal_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE proposal_votes (
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  vote_type TEXT NOT NULL,
  perspective_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, voter_id, vote_type, perspective_id)
);

CREATE TABLE knowledge_packs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  quality_tier TEXT NOT NULL,
  graph_version TEXT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_installed_packs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);

CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_user_concept_states_due ON user_concept_states(user_id, next_due_at);
CREATE INDEX idx_learning_events_user_created ON learning_events(user_id, created_at DESC);
CREATE INDEX idx_audit_events_actor_created ON audit_events(actor_id, created_at DESC);
CREATE INDEX idx_assessment_responses_user_created ON assessment_responses(user_id, created_at DESC);
CREATE INDEX idx_proposals_status ON proposals(status);
CREATE INDEX idx_creator_ingestions_creator_created ON creator_ingestions(creator_id, created_at DESC);
CREATE INDEX idx_creator_ingestions_status ON creator_ingestions(status);
CREATE INDEX idx_concepts_domain ON concepts(domain, subdomain);
