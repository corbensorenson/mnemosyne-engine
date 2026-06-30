import type {
  BadgeTemplate,
  Claim,
  ConceptEdge,
  ConceptNode,
  PacedReadAsset,
  Goal,
  MasterGraph,
  Proposal,
  ReadinessProfile,
  SleepCueTemplate,
  SourceRef,
  User,
  UserConceptState,
  VideoAsset
} from "@mnemosyne/schema";
import { createId, nowIso } from "@mnemosyne/shared-utils";

const now = nowIso();

const researchSource: SourceRef = {
  id: "src_learning_science",
  title: "Learning science evidence base",
  citation: "Practice testing, distributed practice, and successive relearning literature",
  source_type: "paper",
  quality_score: 0.88
};

const graphSource: SourceRef = {
  id: "src_open_graph",
  title: "Open graph governance model",
  citation: "Statement, reference, qualifier, rank, and audit-trail pattern",
  source_type: "dataset",
  quality_score: 0.82
};

export const demoUser: User = {
  id: "user_demo",
  display_name: "Ari",
  handle: "ari",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  privacy_settings: { private_default: true, voice_retention: "transcript_only" },
  social_settings: { share_level: "badges_only", challenge_mode: true },
  notification_settings: { dusk_quiet: true, morning_prompt: true },
  default_session_preferences: { morning_minutes: 30, evening_minutes: 30 },
  accessibility_preferences: { high_contrast: false, reduced_motion: false },
  modality_preferences: { voice_first: true, walking: true, paced_read: true },
  created_at: now,
  updated_at: now
};

export const defaultReadiness: ReadinessProfile = {
  sleep_quality: 0.74,
  fatigue: 0.28,
  stress: 0.34,
  available_minutes_morning: 30,
  available_minutes_evening: 30,
  screen_budget_minutes: 32,
  voice_ok: true,
  dusk_mode: true,
  notes: "normal training day"
};

function edge(fromId: string, toId: string, strength = 0.78): ConceptEdge {
  return {
    from_id: fromId,
    to_id: toId,
    edge_type: "prerequisite",
    strength,
    confidence: 0.82,
    evidence: [graphSource],
    learning_outcome_support: [],
    status: "preferred",
    created_by: "system",
    arbiter_verdict_ids: []
  };
}

function cue(conceptId: string, text: string, specificity = 0.8): SleepCueTemplate {
  return {
    id: createId("cue", `${conceptId}:${text}`),
    concept_id: conceptId,
    cue_type: "spoken",
    text,
    duration_ms: 1900,
    recommended_volume_db: -32,
    cue_specificity: specificity,
    cross_talk_risk: 0.22,
    sleep_safety_score: 0.86,
    emotional_activation_score: 0.18,
    eligible_sleep_stages: "estimated_nrem",
    status: "active"
  };
}

function pacedRead(id: string, title: string, conceptIds: string[], rawText: string): PacedReadAsset {
  return {
    id,
    title,
    source_id: `source_${id}`,
    concept_ids: conceptIds,
    mode: "review",
    raw_text: rawText,
    recommended_wpm: 360,
    cognitive_load_score: 0.36,
    comprehension_gate: "Name the mechanism, an example, and a boundary."
  };
}

function concept(input: {
  id: string;
  slug: string;
  title: string;
  domain: string;
  subdomain?: string;
  type: ConceptNode["concept_type"];
  difficulty: number;
  importance: number;
  abstraction: number;
  definition: string;
  cue: string;
  successors?: readonly string[];
  prerequisites?: readonly string[];
  flashText?: string;
}): ConceptNode {
  const prereqEdges = (input.prerequisites ?? []).map((from) => edge(from, input.id));
  const successorEdges = (input.successors ?? []).map((to) => edge(input.id, to));
  const sleepCue = cue(input.id, input.cue);
  const pacedReadAsset = pacedRead(
    `paced_read_${input.id}`,
    `${input.title} recap`,
    [input.id],
    input.flashText ?? `${input.title}: ${input.definition} Retrieve it, apply it, and name when it breaks.`
  );
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    domain: input.domain,
    subdomain: input.subdomain,
    concept_type: input.type,
    claim_ids: [`claim_${input.id}`],
    prerequisites: prereqEdges,
    successors: successorEdges,
    related_concepts: [],
    difficulty: input.difficulty,
    importance: input.importance,
    abstraction_level: input.abstraction,
    volatility: 0.18,
    definitions: [{ text: input.definition, audience: "expert-learner", status: "active" }],
    explanations: [{ text: input.definition, mode: "compressed" }],
    examples: [{ text: `Worked example for ${input.title}` }],
    counterexamples: [{ text: `Boundary case for ${input.title}` }],
    misconceptions: [{ text: `Knowing the label without being able to use ${input.title}.` }],
    assessments: [],
    sleep_cues: [sleepCue],
    haptic_cues: [],
    visual_assets: [{ kind: "graph_node", palette: input.domain }],
    video_assets: [],
    paced_read_assets: [pacedReadAsset],
    learning_paths: [],
    status: "active",
    created_at: now,
    updated_at: now,
    version: "0.1.0"
  };
}

const conceptSpecs = [
  {
    id: "spanish_greetings",
    slug: "spanish-greetings",
    title: "Spanish greetings",
    domain: "language",
    subdomain: "Spanish Travel",
    type: "language_phrase",
    difficulty: 0.18,
    importance: 0.88,
    abstraction: 0.16,
    definition: "Common greetings, closings, and polite openings used in everyday Spanish conversation.",
    cue: "buenos dias"
  },
  {
    id: "spanish_numbers",
    slug: "spanish-numbers",
    title: "Spanish numbers",
    domain: "language",
    subdomain: "Spanish Travel",
    type: "language_phrase",
    difficulty: 0.22,
    importance: 0.82,
    abstraction: 0.2,
    definition: "Cardinal numbers and price/listening patterns needed for travel transactions.",
    cue: "cuanto cuesta"
  },
  {
    id: "spanish_restaurant",
    slug: "spanish-restaurant-ordering",
    title: "Restaurant ordering",
    domain: "language",
    subdomain: "Spanish Travel",
    type: "procedure",
    difficulty: 0.38,
    importance: 0.93,
    abstraction: 0.34,
    definition: "A phrase sequence for entering, ordering, clarifying, paying, and thanking in restaurants.",
    cue: "la cuenta por favor",
    prerequisites: ["spanish_greetings", "spanish_numbers"],
    successors: ["mexico_etiquette"]
  },
  {
    id: "spanish_directions",
    slug: "spanish-directions",
    title: "Asking directions",
    domain: "language",
    subdomain: "Spanish Travel",
    type: "procedure",
    difficulty: 0.42,
    importance: 0.86,
    abstraction: 0.32,
    definition:
      "A compact path for asking location, understanding left/right/straight, and repairing confusion.",
    cue: "a la derecha",
    prerequisites: ["spanish_greetings"]
  },
  {
    id: "mexico_etiquette",
    slug: "mexico-restaurant-etiquette",
    title: "Mexico restaurant etiquette",
    domain: "history",
    subdomain: "Mexico context",
    type: "judgment",
    difficulty: 0.46,
    importance: 0.72,
    abstraction: 0.38,
    definition:
      "Practical norms around greeting, seating, tipping, pace, and politeness in Mexican restaurants.",
    cue: "saludar primero",
    prerequisites: ["spanish_restaurant"]
  },
  {
    id: "python_variables",
    slug: "python-variables",
    title: "Python variables",
    domain: "coding",
    subdomain: "Python Basics",
    type: "definition",
    difficulty: 0.18,
    importance: 0.76,
    abstraction: 0.32,
    definition: "Names bind to objects; assignment changes the binding, not a hidden box.",
    cue: "name binds object",
    successors: ["python_functions"]
  },
  {
    id: "python_functions",
    slug: "python-functions",
    title: "Python functions",
    domain: "coding",
    subdomain: "Python Basics",
    type: "procedure",
    difficulty: 0.36,
    importance: 0.84,
    abstraction: 0.46,
    definition: "Reusable callables with parameters, return values, scope, and testable behavior.",
    cue: "input body return",
    prerequisites: ["python_variables"],
    successors: ["python_debugging"]
  },
  {
    id: "python_debugging",
    slug: "python-debugging",
    title: "Python debugging loop",
    domain: "coding",
    subdomain: "Python Basics",
    type: "procedure",
    difficulty: 0.54,
    importance: 0.89,
    abstraction: 0.52,
    definition: "Reproduce, isolate, inspect state, form a hypothesis, change one variable, and retest.",
    cue: "reproduce isolate inspect",
    prerequisites: ["python_functions"]
  },
  {
    id: "linear_systems",
    slug: "linear-systems",
    title: "Linear systems",
    domain: "math",
    subdomain: "Linear Algebra",
    type: "model",
    difficulty: 0.48,
    importance: 0.9,
    abstraction: 0.62,
    definition:
      "A system of linear equations represents constraints whose solutions can be geometric objects.",
    cue: "constraints intersection",
    successors: ["eigenvectors", "ai_vectors"]
  },
  {
    id: "eigenvectors",
    slug: "eigenvectors",
    title: "Eigenvectors",
    domain: "math",
    subdomain: "Linear Algebra",
    type: "model",
    difficulty: 0.68,
    importance: 0.82,
    abstraction: 0.78,
    definition: "Directions preserved by a linear transformation, changing only by a scalar factor.",
    cue: "same direction scaled",
    prerequisites: ["linear_systems"]
  },
  {
    id: "ai_vectors",
    slug: "ai-vector-representations",
    title: "Vector representations",
    domain: "ai",
    subdomain: "AI Systems",
    type: "model",
    difficulty: 0.44,
    importance: 0.92,
    abstraction: 0.64,
    definition:
      "Embeddings represent items as vectors whose geometry supports similarity and transformation.",
    cue: "geometry carries meaning",
    prerequisites: ["linear_systems"],
    successors: ["attention_qkv"]
  },
  {
    id: "attention_qkv",
    slug: "attention-qkv",
    title: "Q/K/V attention",
    domain: "ai",
    subdomain: "AI Systems",
    type: "model",
    difficulty: 0.72,
    importance: 0.95,
    abstraction: 0.82,
    definition: "Queries compare with keys to weight values, letting context select relevant information.",
    cue: "queries keys values",
    prerequisites: ["ai_vectors"],
    successors: ["transformer_blocks"]
  },
  {
    id: "transformer_blocks",
    slug: "transformer-blocks",
    title: "Transformer blocks",
    domain: "ai",
    subdomain: "AI Systems",
    type: "system",
    difficulty: 0.76,
    importance: 0.9,
    abstraction: 0.86,
    definition:
      "Attention, residual streams, normalization, and feed-forward layers composed into a trainable block.",
    cue: "attention residual mlp",
    prerequisites: ["attention_qkv"]
  }
] as const;

export const demoConcepts = conceptSpecs.map((spec) => concept(spec));
export const demoEdges = demoConcepts.flatMap((item) => item.prerequisites);
const cueMap = demoConcepts.flatMap((item) => item.sleep_cues);
const pacedReadMap = demoConcepts.flatMap((item) => item.paced_read_assets);

export const demoClaims: Claim[] = demoConcepts.map((item) => ({
  id: `claim_${item.id}`,
  subject_id: item.id,
  predicate_id: "has_learning_definition",
  object_value: (item.definitions[0] as { text: string }).text,
  qualifiers: { domain_context: item.domain },
  sources: [researchSource],
  epistemic_status: "pedagogical_simplification",
  confidence_score: 0.78,
  controversy_score: 0.18,
  freshness_score: 0.72,
  source_quality_score: 0.82,
  created_at: now,
  updated_at: now,
  last_reviewed_at: now,
  review_after: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
  graph_version_introduced: "0.1.0",
  arbiter_verdict_ids: []
}));

function video(input: {
  id: string;
  title: string;
  creator: string;
  duration: number;
  conceptIds: string[];
  prereq?: string[];
  horizon?: string[];
  type: VideoAsset["video_type"];
  difficulty: number;
  quality: number;
}): VideoAsset {
  return {
    id: input.id,
    source_platform: "youtube",
    external_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    embeddable: true,
    title: input.title,
    creator: input.creator,
    duration_seconds: input.duration,
    transcript_id: `transcript_${input.id}`,
    chapter_map: [
      { start: 0, title: "activate prior graph" },
      { start: Math.floor(input.duration / 2), title: "worked transfer" }
    ],
    concept_ids: input.conceptIds,
    prerequisite_concept_ids: input.prereq ?? [],
    horizon_concept_ids: input.horizon ?? [],
    video_type: input.type,
    difficulty: input.difficulty,
    concept_density: 0.68,
    entertainment_score: 0.62,
    cognitive_load_score: input.difficulty * 0.74,
    misinformation_risk: 0.08,
    sponsor_noise_score: 0.12,
    source_quality_score: input.quality,
    screen_efficiency_score: 0.76,
    retention_lift_score: 0.7,
    transfer_lift_score: 0.66,
    quiz_items: [],
    paced_read_recaps: pacedReadMap.filter((asset) =>
      asset.concept_ids.some((conceptId) => input.conceptIds.includes(conceptId))
    ),
    sleep_safe_cues: cueMap.filter((item) => input.conceptIds.includes(item.concept_id)),
    status: input.quality > 0.8 ? "gold" : "active"
  };
}

export const demoVideos: VideoAsset[] = [
  video({
    id: "video_spanish_restaurant",
    title: "Restaurant Spanish: order, clarify, pay",
    creator: "Open Travel Spanish",
    duration: 1120,
    conceptIds: ["spanish_restaurant", "spanish_numbers"],
    prereq: ["spanish_greetings"],
    horizon: ["mexico_etiquette"],
    type: "tutorial",
    difficulty: 0.38,
    quality: 0.84
  }),
  video({
    id: "video_mexico_etiquette",
    title: "Mexico dining norms and phrase timing",
    creator: "Cultura Clara",
    duration: 1680,
    conceptIds: ["mexico_etiquette", "spanish_restaurant"],
    prereq: ["spanish_greetings"],
    horizon: ["spanish_directions"],
    type: "story",
    difficulty: 0.46,
    quality: 0.78
  }),
  video({
    id: "video_python_debugging",
    title: "Debugging as a tight hypothesis loop",
    creator: "Practical Python Lab",
    duration: 1460,
    conceptIds: ["python_debugging", "python_functions"],
    prereq: ["python_variables"],
    type: "worked_example",
    difficulty: 0.56,
    quality: 0.82
  }),
  video({
    id: "video_attention",
    title: "Q/K/V attention without the fog",
    creator: "Open AI Systems",
    duration: 1540,
    conceptIds: ["attention_qkv", "ai_vectors"],
    prereq: ["linear_systems"],
    horizon: ["transformer_blocks"],
    type: "simulation",
    difficulty: 0.72,
    quality: 0.86
  }),
  video({
    id: "video_eigenvectors",
    title: "Eigenvectors as preserved directions",
    creator: "Linear Maps Studio",
    duration: 980,
    conceptIds: ["eigenvectors", "linear_systems"],
    type: "lecture",
    difficulty: 0.66,
    quality: 0.8
  })
];

export const demoMasterGraph: MasterGraph = {
  concepts: demoConcepts.map((item) => ({
    ...item,
    video_assets: demoVideos.filter((asset) => asset.concept_ids.includes(item.id)).map((asset) => asset.id)
  })),
  claims: demoClaims,
  edges: demoEdges,
  videos: demoVideos,
  sleepCues: cueMap,
  pacedReads: pacedReadMap
};

function state(conceptId: string, mastery: number, stability: number, transfer: number): UserConceptState {
  return {
    user_id: demoUser.id,
    concept_id: conceptId,
    mastery,
    recall_strength: Math.max(0.08, mastery - 0.08),
    recall_stability: stability,
    transfer_score: transfer,
    answer_latency_ms: Math.round(15000 + (1 - mastery) * 26000),
    confidence_calibration: mastery > 0.62 ? 0.74 : 0.48,
    false_confidence_risk: transfer < 0.42 && mastery > 0.48 ? 0.68 : 0.22,
    prerequisite_health: 0.68 + mastery * 0.2,
    failure_modes: transfer < 0.45 ? ["shallow_transfer"] : ["none"],
    misconception_ids: [],
    last_seen_at: now,
    last_correct_at: mastery > 0.55 ? now : undefined,
    next_due_at: new Date(Date.now() + (1 - stability) * 1000 * 60 * 60 * 24 * 2).toISOString(),
    times_seen: Math.round(2 + mastery * 12),
    times_recalled: Math.round(mastery * 8),
    times_failed: mastery < 0.5 ? 2 : 0,
    hints_used: mastery < 0.5 ? 2 : 0,
    sleep_replays: Math.round(stability * 5),
    cue_gain_estimate: mastery > 0.5 ? 0.08 : 0.02,
    best_cue_type: "spoken",
    modality_response_profile: { voice: 0.72, visual: 0.58, walking: 0.76 },
    status: mastery > 0.8 ? "fluent" : mastery > 0.62 ? "known" : mastery > 0.4 ? "fragile" : "learning",
    updated_at: now
  };
}

export const initialUserStates: UserConceptState[] = [
  state("spanish_greetings", 0.78, 0.66, 0.58),
  state("spanish_numbers", 0.63, 0.44, 0.5),
  state("spanish_restaurant", 0.43, 0.32, 0.34),
  state("spanish_directions", 0.36, 0.28, 0.29),
  state("python_variables", 0.84, 0.78, 0.72),
  state("python_functions", 0.62, 0.42, 0.46),
  state("python_debugging", 0.35, 0.22, 0.31),
  state("linear_systems", 0.58, 0.4, 0.49),
  state("ai_vectors", 0.46, 0.34, 0.42),
  state("attention_qkv", 0.24, 0.18, 0.2)
];

export function emptyState(conceptId: string): UserConceptState {
  return state(conceptId, 0.12, 0.08, 0.08);
}

export const demoGoals: Goal[] = [
  {
    id: "goal_mexico_trip",
    user_id: demoUser.id,
    title: "Mexico trip readiness",
    description: "Travel Spanish plus cultural context for restaurant, transit, and everyday interactions.",
    goal_type: "trip",
    target_concept_ids: ["spanish_restaurant", "spanish_directions", "mexico_etiquette"],
    target_domain_ids: ["language", "history"],
    priority: 0.9,
    deadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 42).toISOString(),
    intensity: "sprint",
    desired_modalities: ["voice", "audio", "walking"],
    avoid_modalities: ["visual"],
    created_at: now,
    updated_at: now
  },
  {
    id: "goal_ai_systems",
    user_id: demoUser.id,
    title: "AI systems fluency",
    description: "Understand attention and transformer blocks deeply enough to explain and debug.",
    goal_type: "career",
    target_concept_ids: ["ai_vectors", "attention_qkv", "transformer_blocks"],
    target_domain_ids: ["ai", "math"],
    priority: 0.82,
    intensity: "normal",
    desired_modalities: ["visual", "voice", "text"],
    avoid_modalities: [],
    created_at: now,
    updated_at: now
  }
];

export const demoBadges: BadgeTemplate[] = [
  {
    id: "badge_eyes_free_morning",
    title: "Eyes-Free Morning",
    description: "Complete a Morning Forge with less than five screen minutes.",
    category: "voice",
    requirements: [{ metric: "screen_minutes", op: "<=", value: 5 }],
    rarity: "rare"
  },
  {
    id: "badge_sleep_guardian",
    title: "Sleep Guardian",
    description: "Keep cue density low while measuring cue gain with controls.",
    category: "sleep",
    requirements: [{ metric: "sleep_integrity", op: ">=", value: 0.9 }],
    rarity: "epic"
  },
  {
    id: "badge_no_scroll_scholar",
    title: "No-Scroll Scholar",
    description: "Finish bounded GraphFeed packets with post-watch recall.",
    category: "screen_efficiency",
    requirements: [{ metric: "bounded_video_packets", op: ">=", value: 7 }],
    rarity: "rare"
  }
];

export const demoProposals: Proposal[] = [
  {
    id: "proposal_attention_case_file",
    proposer_id: "ai_agent",
    proposal_type: "modify_definition",
    affected_object_ids: ["attention_qkv"],
    diff: {
      before: "Attention weights values.",
      after: "Queries compare with keys to weight values, selecting context-relevant information."
    },
    rationale: "The expanded definition reduces the common misconception that attention is a lookup table.",
    evidence_for: [researchSource],
    evidence_against: [],
    expected_learning_impact: "+7 percent transfer on Q/K/V oral board prompts",
    risk_level: "low",
    community_votes: {
      "clear:novice": 4,
      "great_for_experts:builder": 2,
      "needs_expert_review:researcher": 1
    },
    expert_comments: [],
    status: "ai_reviewing",
    created_at: now,
    updated_at: now
  }
];
