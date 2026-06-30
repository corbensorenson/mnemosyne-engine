import { z } from "zod";

export const modalitySchema = z.enum([
  "audio",
  "visual",
  "voice",
  "text",
  "haptic",
  "video",
  "drawing",
  "walking"
]);
export type Modality = z.infer<typeof modalitySchema>;

export const conceptTypeSchema = z.enum([
  "fact",
  "association",
  "definition",
  "procedure",
  "pattern",
  "model",
  "argument",
  "judgment",
  "motor_adjacent",
  "language_phrase",
  "system"
]);
export type ConceptType = z.infer<typeof conceptTypeSchema>;

export const sourceRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  citation: z.string().optional(),
  source_type: z
    .enum(["paper", "book", "website", "dataset", "expert", "course", "user_note", "unknown"])
    .default("unknown"),
  quality_score: z.number().min(0).max(1).default(0.5)
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const claimSchema = z.object({
  id: z.string(),
  subject_id: z.string(),
  predicate_id: z.string(),
  object_value: z.union([z.string(), z.number(), z.boolean()]),
  qualifiers: z
    .object({
      scope: z.string().optional(),
      population: z.string().optional(),
      method: z.string().optional(),
      valid_from: z.string().optional(),
      valid_to: z.string().optional(),
      confidence_interval: z.string().optional(),
      jurisdiction: z.string().optional(),
      domain_context: z.string().optional(),
      assumptions: z.array(z.string()).optional()
    })
    .default({}),
  sources: z.array(sourceRefSchema).default([]),
  epistemic_status: z.enum([
    "accepted",
    "preferred",
    "disputed",
    "minority_view",
    "speculative",
    "deprecated",
    "retracted",
    "superseded",
    "contextual",
    "pedagogical_simplification",
    "unknown"
  ]),
  confidence_score: z.number().min(0).max(1),
  controversy_score: z.number().min(0).max(1),
  freshness_score: z.number().min(0).max(1),
  source_quality_score: z.number().min(0).max(1),
  created_at: z.string(),
  updated_at: z.string(),
  last_reviewed_at: z.string(),
  review_after: z.string().optional(),
  graph_version_introduced: z.string(),
  graph_version_deprecated: z.string().optional(),
  arbiter_verdict_ids: z.array(z.string()).default([])
});
export type Claim = z.infer<typeof claimSchema>;

export const conceptEdgeSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  edge_type: z.enum([
    "prerequisite",
    "successor",
    "analogy",
    "contrast",
    "part_of",
    "causes",
    "enables",
    "commonly_confused_with",
    "example_of",
    "counterexample_of"
  ]),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(sourceRefSchema).default([]),
  learning_outcome_support: z.array(z.record(z.unknown())).default([]),
  status: z.enum(["preferred", "normal", "disputed", "experimental", "deprecated"]),
  created_by: z.enum(["ai", "human", "system"]),
  arbiter_verdict_ids: z.array(z.string()).default([])
});
export type ConceptEdge = z.infer<typeof conceptEdgeSchema>;

export const assessmentTypeSchema = z.enum([
  "free_recall",
  "short_answer",
  "multiple_choice",
  "classification",
  "voice_explanation",
  "pronunciation",
  "translation",
  "timeline",
  "graph_reconstruction",
  "sketch",
  "worked_problem",
  "debugging",
  "simulation",
  "boss_fight",
  "transfer"
]);
export type AssessmentType = z.infer<typeof assessmentTypeSchema>;

export const rubricSchema = z.object({
  must_include: z.array(z.string()).default([]),
  acceptable_aliases: z.array(z.string()).default([]),
  common_failures: z.array(z.string()).default([]),
  transfer_signals: z.array(z.string()).default([])
});
export type Rubric = z.infer<typeof rubricSchema>;

export const assessmentItemSchema = z.object({
  id: z.string(),
  concept_ids: z.array(z.string()),
  assessment_type: assessmentTypeSchema,
  prompt: z.string(),
  expected_answer: z.string().optional(),
  rubric: rubricSchema,
  distractors: z.array(z.string()).optional(),
  difficulty: z.number().min(0).max(1),
  time_limit_seconds: z.number().optional(),
  modality: z.array(modalitySchema),
  created_at: z.string()
});
export type AssessmentItem = z.infer<typeof assessmentItemSchema>;

export const sleepCueTemplateSchema = z.object({
  id: z.string(),
  concept_id: z.string(),
  cue_type: z.enum([
    "spoken",
    "tone",
    "motif",
    "music_embedded",
    "binaural_context",
    "silence_marker"
  ]),
  text: z.string().optional(),
  audio_asset_id: z.string().optional(),
  duration_ms: z.number().int().positive(),
  recommended_volume_db: z.number().optional(),
  cue_specificity: z.number().min(0).max(1),
  cross_talk_risk: z.number().min(0).max(1),
  sleep_safety_score: z.number().min(0).max(1),
  emotional_activation_score: z.number().min(0).max(1),
  eligible_sleep_stages: z.enum([
    "unknown",
    "estimated_nrem",
    "nrem2",
    "slow_wave",
    "avoid_rem",
    "any_non_wake"
  ]),
  status: z.enum(["experimental", "active", "validated", "deprecated", "avoid"])
});
export type SleepCueTemplate = z.infer<typeof sleepCueTemplateSchema>;

export const flashReadAssetSchema = z.object({
  id: z.string(),
  title: z.string(),
  source_id: z.string(),
  concept_ids: z.array(z.string()),
  mode: z.enum(["skim", "learn", "review", "prime", "transcript", "diagnostic"]),
  raw_text: z.string(),
  recommended_wpm: z.number().int(),
  cognitive_load_score: z.number().min(0).max(1),
  comprehension_gate: z.string()
});
export type FlashReadAsset = z.infer<typeof flashReadAssetSchema>;

export const videoAssetSchema = z.object({
  id: z.string(),
  source_platform: z.enum([
    "youtube",
    "vimeo",
    "creator_upload",
    "open_course",
    "partner",
    "native"
  ]),
  external_url: z.string().url().optional(),
  embed_url: z.string().url().optional(),
  embeddable: z.boolean(),
  title: z.string(),
  creator: z.string(),
  duration_seconds: z.number().int().positive(),
  transcript_id: z.string().optional(),
  chapter_map: z.array(z.record(z.unknown())).default([]),
  concept_ids: z.array(z.string()),
  prerequisite_concept_ids: z.array(z.string()).default([]),
  horizon_concept_ids: z.array(z.string()).default([]),
  video_type: z.enum([
    "short",
    "lecture",
    "documentary",
    "worked_example",
    "debate",
    "tutorial",
    "interview",
    "simulation",
    "story"
  ]),
  difficulty: z.number().min(0).max(1),
  concept_density: z.number().min(0).max(1),
  entertainment_score: z.number().min(0).max(1),
  cognitive_load_score: z.number().min(0).max(1),
  misinformation_risk: z.number().min(0).max(1),
  sponsor_noise_score: z.number().min(0).max(1),
  source_quality_score: z.number().min(0).max(1),
  screen_efficiency_score: z.number().min(0).max(1),
  retention_lift_score: z.number().min(0).max(1),
  transfer_lift_score: z.number().min(0).max(1),
  quiz_items: z.array(assessmentItemSchema).default([]),
  flashread_recaps: z.array(flashReadAssetSchema).default([]),
  sleep_safe_cues: z.array(sleepCueTemplateSchema).default([]),
  status: z.enum([
    "submitted",
    "ai_triaged",
    "experimental",
    "active",
    "validated",
    "gold",
    "disputed",
    "deprecated",
    "rejected"
  ])
});
export type VideoAsset = z.infer<typeof videoAssetSchema>;

export const conceptNodeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  domain: z.string(),
  subdomain: z.string().optional(),
  concept_type: conceptTypeSchema,
  claim_ids: z.array(z.string()).default([]),
  prerequisites: z.array(conceptEdgeSchema).default([]),
  successors: z.array(conceptEdgeSchema).default([]),
  related_concepts: z.array(conceptEdgeSchema).default([]),
  difficulty: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  abstraction_level: z.number().min(0).max(1),
  volatility: z.number().min(0).max(1),
  definitions: z.array(z.record(z.unknown())).default([]),
  explanations: z.array(z.record(z.unknown())).default([]),
  examples: z.array(z.record(z.unknown())).default([]),
  counterexamples: z.array(z.record(z.unknown())).default([]),
  misconceptions: z.array(z.record(z.unknown())).default([]),
  assessments: z.array(assessmentItemSchema).default([]),
  sleep_cues: z.array(sleepCueTemplateSchema).default([]),
  haptic_cues: z.array(z.record(z.unknown())).default([]),
  visual_assets: z.array(z.record(z.unknown())).default([]),
  video_assets: z.array(z.string()).default([]),
  flashread_assets: z.array(flashReadAssetSchema).default([]),
  learning_paths: z.array(z.record(z.unknown())).default([]),
  status: z.enum(["active", "experimental", "disputed", "deprecated", "archived"]),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.string()
});
export type ConceptNode = z.infer<typeof conceptNodeSchema>;

export const userSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  handle: z.string(),
  timezone: z.string(),
  privacy_settings: z.record(z.unknown()).default({ private_default: true }),
  social_settings: z.record(z.unknown()).default({ share_level: "private" }),
  notification_settings: z.record(z.unknown()).default({ dusk_quiet: true }),
  default_session_preferences: z.record(z.unknown()).default({ morning_minutes: 30 }),
  accessibility_preferences: z.record(z.unknown()).default({ high_contrast: false }),
  modality_preferences: z.record(z.unknown()).default({ voice_first: true }),
  created_at: z.string(),
  updated_at: z.string()
});
export type User = z.infer<typeof userSchema>;

export const userConceptStateSchema = z.object({
  user_id: z.string(),
  concept_id: z.string(),
  mastery: z.number().min(0).max(1),
  recall_strength: z.number().min(0).max(1),
  recall_stability: z.number().min(0).max(1),
  transfer_score: z.number().min(0).max(1),
  answer_latency_ms: z.number().nullable(),
  confidence_calibration: z.number().min(0).max(1),
  false_confidence_risk: z.number().min(0).max(1),
  prerequisite_health: z.number().min(0).max(1),
  failure_modes: z.array(z.string()).default([]),
  misconception_ids: z.array(z.string()).default([]),
  last_seen_at: z.string().optional(),
  last_correct_at: z.string().optional(),
  next_due_at: z.string().optional(),
  times_seen: z.number().int().nonnegative(),
  times_recalled: z.number().int().nonnegative(),
  times_failed: z.number().int().nonnegative(),
  hints_used: z.number().int().nonnegative(),
  sleep_replays: z.number().int().nonnegative(),
  cue_gain_estimate: z.number().min(-1).max(1),
  best_cue_type: z.string().optional(),
  modality_response_profile: z.record(z.unknown()).default({}),
  status: z.enum([
    "unknown",
    "previewed",
    "learning",
    "fragile",
    "known",
    "fluent",
    "decaying",
    "mastered"
  ]),
  updated_at: z.string()
});
export type UserConceptState = z.infer<typeof userConceptStateSchema>;

export const goalSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string(),
  description: z.string(),
  goal_type: z.enum([
    "trip",
    "exam",
    "career",
    "project",
    "curiosity",
    "skill",
    "certification",
    "custom"
  ]),
  target_concept_ids: z.array(z.string()),
  target_domain_ids: z.array(z.string()),
  priority: z.number().min(0).max(1),
  deadline: z.string().optional(),
  intensity: z.enum(["maintenance", "normal", "sprint", "elite"]),
  desired_modalities: z.array(modalitySchema),
  avoid_modalities: z.array(modalitySchema),
  created_at: z.string(),
  updated_at: z.string()
});
export type Goal = z.infer<typeof goalSchema>;

export const assessmentResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  assessment_item_id: z.string(),
  raw_response: z.union([z.string(), z.record(z.unknown())]),
  correctness_score: z.number().min(0).max(1),
  semantic_score: z.number().min(0).max(1),
  latency_ms: z.number().int().nonnegative(),
  confidence_reported: z.number().min(0).max(1).optional(),
  hint_count: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  detected_failure_modes: z.array(z.string()),
  misconception_ids: z.array(z.string()).default([]),
  model_feedback: z.string(),
  graph_updates: z.array(z.record(z.unknown())),
  created_at: z.string()
});
export type AssessmentResponse = z.infer<typeof assessmentResponseSchema>;

export const readinessProfileSchema = z.object({
  sleep_quality: z.number().min(0).max(1),
  fatigue: z.number().min(0).max(1),
  stress: z.number().min(0).max(1),
  available_minutes_morning: z.number().int().positive(),
  available_minutes_evening: z.number().int().positive(),
  screen_budget_minutes: z.number().int().nonnegative(),
  voice_ok: z.boolean(),
  dusk_mode: z.boolean(),
  notes: z.string().optional()
});
export type ReadinessProfile = z.infer<typeof readinessProfileSchema>;

export const watchPacketSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  purpose: z.enum(["relax", "review", "deepen", "preview", "boss_prep", "rabbit_hole"]),
  total_time_budget_minutes: z.number().int().positive(),
  video_ids: z.array(z.string()),
  target_concept_ids: z.array(z.string()),
  expected_graph_effect: z.record(z.unknown()),
  required_post_watch_recall: z.boolean(),
  suggested_next_mode: z.enum(["walk_recall", "evening_lock_in", "sleep_packet", "stop"]),
  created_at: z.string()
});
export type WatchPacket = z.infer<typeof watchPacketSchema>;

export const walkPacketSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  target_concept_ids: z.array(z.string()),
  prompts: z.array(assessmentItemSchema),
  voice_commands: z.array(z.string()),
  screen_policy: z.enum(["screen_locked", "glance_only", "visual_required"]),
  created_at: z.string()
});
export type WalkPacket = z.infer<typeof walkPacketSchema>;

export const morningPacketSchema = z.object({
  cold_retrieval_items: z.array(assessmentItemSchema),
  error_repair_items: z.array(z.string()),
  frontier_items: z.array(conceptNodeSchema),
  horizon_items: z.array(conceptNodeSchema),
  cue_preview_items: z.array(sleepCueTemplateSchema),
  recommended_mode: z.enum(["walk", "desk", "audio_only", "audio_visual", "visual_burst"])
});
export type MorningPacket = z.infer<typeof morningPacketSchema>;

export const eveningPacketSchema = z.object({
  recall_items: z.array(assessmentItemSchema),
  interleaved_review_items: z.array(assessmentItemSchema),
  transfer_drills: z.array(assessmentItemSchema),
  failure_map_updates: z.array(z.string()),
  sleep_cue_binding_items: z.array(sleepCueTemplateSchema),
  screen_policy: z.enum(["audio_only", "minimal_visual", "visual_required"])
});
export type EveningPacket = z.infer<typeof eveningPacketSchema>;

export const sleepCuePacketSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  night_date: z.string(),
  target_sleep_window: z.object({
    estimated_sleep_onset_at: z.string(),
    cue_start_delay_minutes: z.number().int().nonnegative(),
    cue_end_before_wake_minutes: z.number().int().optional()
  }),
  audio_plan_id: z.string(),
  reactivate_concept_ids: z.array(z.string()),
  stabilize_concept_ids: z.array(z.string()),
  prime_concept_ids: z.array(z.string()),
  control_concept_ids: z.array(z.string()),
  cue_spacing_seconds: z.number().int().positive(),
  max_cues_per_hour: z.number().int().positive(),
  max_volume: z.number().min(0).max(1),
  stop_conditions: z.record(z.boolean()).default({}),
  experiment_assignments: z.array(z.record(z.unknown())).default([]),
  created_at: z.string()
});
export type SleepCuePacket = z.infer<typeof sleepCuePacketSchema>;

export const audioPlanSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  duration_seconds: z.number().int().positive(),
  layers: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["ambience", "silence", "spoken_cue", "tone", "fade"]),
      starts_at_seconds: z.number().nonnegative(),
      duration_seconds: z.number().positive(),
      volume: z.number().min(0).max(1),
      label: z.string()
    })
  ),
  rendered_asset_id: z.string().optional(),
  render_status: z.enum(["pending", "rendering", "ready", "failed"]),
  created_at: z.string()
});
export type AudioPlan = z.infer<typeof audioPlanSchema>;

export const dailyLearningPacketSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  date: z.string(),
  readiness_profile: readinessProfileSchema,
  morning: morningPacketSchema,
  optional_watch_packets: z.array(watchPacketSchema),
  walk_packets: z.array(walkPacketSchema),
  evening: eveningPacketSchema,
  sleep: sleepCuePacketSchema,
  graph_delta_target: z.record(z.unknown()),
  created_at: z.string()
});
export type DailyLearningPacket = z.infer<typeof dailyLearningPacketSchema>;

export const learningEventSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  event_type: z.enum([
    "session_started",
    "concept_seen",
    "assessment_answered",
    "cue_bound",
    "sleep_cue_played",
    "video_watched",
    "flashread_completed",
    "walk_recall_completed",
    "graph_updated",
    "proposal_submitted",
    "content_reviewed"
  ]),
  payload: z.record(z.unknown()),
  created_at: z.string()
});
export type LearningEvent = z.infer<typeof learningEventSchema>;

export const proposalSchema = z.object({
  id: z.string(),
  proposer_id: z.union([z.string(), z.literal("ai_agent")]),
  proposal_type: z.enum([
    "add_claim",
    "modify_claim",
    "deprecate_claim",
    "add_concept",
    "split_concept",
    "merge_concepts",
    "add_edge",
    "remove_edge",
    "modify_definition",
    "add_video",
    "rank_video",
    "add_assessment",
    "modify_sleep_cue",
    "change_learning_path",
    "flag_misinformation",
    "flag_outdated",
    "change_badge"
  ]),
  affected_object_ids: z.array(z.string()),
  diff: z.record(z.unknown()),
  rationale: z.string(),
  evidence_for: z.array(sourceRefSchema).default([]),
  evidence_against: z.array(sourceRefSchema).default([]),
  expected_learning_impact: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high", "critical"]),
  community_votes: z.record(z.number()).default({}),
  expert_comments: z.array(z.record(z.unknown())).default([]),
  ai_review: z.record(z.unknown()).optional(),
  status: z.enum([
    "open",
    "needs_evidence",
    "ai_reviewing",
    "human_review_required",
    "accepted",
    "accepted_with_modifications",
    "rejected",
    "disputed",
    "merged",
    "reverted"
  ]),
  created_at: z.string(),
  updated_at: z.string()
});
export type Proposal = z.infer<typeof proposalSchema>;

export const arbiterVerdictSchema = z.object({
  id: z.string(),
  proposal_id: z.string(),
  decision: z.enum([
    "accept",
    "accept_with_modifications",
    "reject",
    "needs_more_evidence",
    "send_to_human_moderation",
    "mark_as_disputed",
    "split_into_multiple_claims"
  ]),
  reasoning_summary: z.string(),
  strongest_argument_for: z.string(),
  strongest_argument_against: z.string(),
  source_audit: z.array(z.record(z.unknown())),
  ontology_audit: z.record(z.unknown()),
  pedagogy_audit: z.record(z.unknown()),
  safety_audit: z.record(z.unknown()),
  outcome_audit: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1),
  appealable: z.boolean(),
  required_review_date: z.string().optional(),
  model_version: z.string(),
  policy_version: z.string(),
  created_at: z.string()
});
export type ArbiterVerdict = z.infer<typeof arbiterVerdictSchema>;

export const experimentSchema = z.object({
  id: z.string(),
  title: z.string(),
  experiment_type: z.enum([
    "technique",
    "content",
    "learning_path",
    "sleep_cue",
    "video",
    "flashread",
    "audio_speed",
    "gamification",
    "typography"
  ]),
  hypothesis: z.string(),
  unit_of_randomization: z.enum(["user", "concept", "session", "content_object", "cue"]),
  conditions: z.array(z.record(z.unknown())),
  assignment_strategy: z.enum(["random", "stratified", "within_user_matched", "multi_armed_bandit"]),
  metrics: z.array(z.string()),
  status: z.enum(["draft", "running", "paused", "completed", "deprecated"]),
  created_at: z.string()
});
export type Experiment = z.infer<typeof experimentSchema>;

export const techniqueSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum([
    "retrieval",
    "spacing",
    "visual_intake",
    "audio_intake",
    "sleep",
    "video",
    "embodied",
    "memory",
    "pattern",
    "social",
    "gamification",
    "typography",
    "experimental"
  ]),
  applicable_concept_types: z.array(conceptTypeSchema),
  contraindications: z.array(z.string()),
  required_inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  default_parameters: z.record(z.unknown()),
  user_parameter_overrides: z.record(z.unknown()).default({}),
  evidence_level: z.enum(["strong", "moderate", "experimental", "speculative"]),
  experiment_design: z.record(z.unknown())
});
export type Technique = z.infer<typeof techniqueSchema>;

export const badgeTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum([
    "consistency",
    "depth",
    "breadth",
    "retention",
    "speed",
    "sleep",
    "screen_efficiency",
    "voice",
    "social",
    "creator",
    "hard_mode"
  ]),
  requirements: z.array(z.record(z.unknown())),
  rarity: z.enum(["common", "rare", "epic", "legendary"]),
  graph_scope: z.array(z.string()).optional()
});
export type BadgeTemplate = z.infer<typeof badgeTemplateSchema>;

export const knowledgePackSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  domain: z.string(),
  author_ids: z.array(z.string()),
  license: z.string(),
  source_ids: z.array(z.string()),
  concepts: z.array(conceptNodeSchema),
  claims: z.array(claimSchema),
  edges: z.array(conceptEdgeSchema),
  assessments: z.array(assessmentItemSchema),
  sleep_cues: z.array(sleepCueTemplateSchema),
  videos: z.array(videoAssetSchema),
  flashread_assets: z.array(flashReadAssetSchema),
  badges: z.array(badgeTemplateSchema),
  boss_fights: z.array(assessmentItemSchema),
  quality_tier: z.enum(["personal", "community", "tested", "expert_reviewed", "gold", "canonical"]),
  graph_version: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});
export type KnowledgePack = z.infer<typeof knowledgePackSchema>;

export const deviceCapabilityProfileSchema = z.object({
  platform: z.enum(["ios", "android", "desktop", "unknown"]),
  pwa_installed: z.boolean(),
  web_push_supported: z.boolean(),
  background_audio_supported: z.boolean(),
  microphone_supported: z.boolean(),
  notifications_permission: z.enum(["granted", "denied", "prompt"]),
  healthkit_available: z.boolean(),
  health_connect_available: z.boolean(),
  oura_connected: z.boolean(),
  bluetooth_supported: z.boolean(),
  offline_cache_supported: z.boolean()
});
export type DeviceCapabilityProfile = z.infer<typeof deviceCapabilityProfileSchema>;

export type MasterGraph = {
  concepts: ConceptNode[];
  claims: Claim[];
  edges: ConceptEdge[];
  videos: VideoAsset[];
  sleepCues: SleepCueTemplate[];
  flashReads: FlashReadAsset[];
};

export type UserKnowledgeGraph = {
  userId: string;
  states: UserConceptState[];
};
