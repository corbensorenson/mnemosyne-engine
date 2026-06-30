import type {
  AssessmentResponse,
  ConceptType,
  Experiment,
  LearningEvent,
  ReadinessProfile,
  SleepCuePacket,
  Technique,
  UserConceptState
} from "@mnemosyne/schema";
import { clamp, createId, nowIso, round, sortByScore, stableHash, unique } from "@mnemosyne/shared-utils";

const allConceptTypes: ConceptType[] = [
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
];

export const techniqueRegistry: Technique[] = [
  makeTechnique(
    "spaced_retrieval",
    "Spaced retrieval",
    "Retrieval scheduled by stability and goal pressure.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "successive_relearning",
    "Successive relearning",
    "Repeated retrieval to criterion across spaced sessions.",
    "spacing",
    "strong"
  ),
  makeTechnique(
    "failure_first",
    "Pretesting",
    "Ask before teaching to expose missing structure.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "generate_mode",
    "Generation effect",
    "Require learner-generated answers before examples.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "explain_back",
    "Self-explanation",
    "Learner explains mechanism, boundary, and example.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "compare_mode",
    "Interleaving",
    "Mix near neighbors and contrasting cases.",
    "pattern",
    "strong"
  ),
  makeTechnique(
    "example_fade",
    "Worked-example fading",
    "Step support is gradually removed.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "pattern_forge",
    "Perceptual learning",
    "Rapid classification with feedback for patterns.",
    "pattern",
    "moderate"
  ),
  makeTechnique(
    "smart_video",
    "Educational video segmentation",
    "Video is segmented into active recall objects.",
    "video",
    "moderate"
  ),
  makeTechnique(
    "flashread",
    "FlashRead RSVP",
    "Graph-aware chunked RSVP with comprehension gates.",
    "visual_intake",
    "experimental"
  ),
  makeTechnique(
    "typography_lab",
    "Adaptive typography",
    "Tune font, contrast, spacing, and chunking to outcome.",
    "typography",
    "experimental"
  ),
  makeTechnique(
    "speed_listen",
    "SpeedListen",
    "Time-compressed audio with comprehension and strain checks.",
    "audio_intake",
    "experimental"
  ),
  makeTechnique(
    "shadow_speak",
    "Language shadowing",
    "Immediate oral mimicry with pronunciation feedback.",
    "audio_intake",
    "moderate",
    ["language_phrase"]
  ),
  makeTechnique(
    "memory_palace",
    "Memory palace",
    "Spatial binding for ordered or associative content.",
    "memory",
    "moderate"
  ),
  makeTechnique(
    "sketch_lock",
    "Drawing reconstruction",
    "Rebuild visual or structural knowledge from memory.",
    "embodied",
    "moderate"
  ),
  makeTechnique(
    "map_recall",
    "Retrieval concept mapping",
    "Draw graph neighborhoods from memory.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "gesture_bind",
    "Gesture and haptics",
    "Bind motor or haptic cues to recall objects.",
    "embodied",
    "experimental"
  ),
  makeTechnique(
    "walk_mode",
    "Walking recall",
    "Audio recall while moving with screen locked.",
    "embodied",
    "moderate"
  ),
  makeTechnique(
    "curiosity_engine",
    "Knowledge gaps",
    "Use unresolved gap tension to prioritize retrieval.",
    "gamification",
    "moderate"
  ),
  makeTechnique(
    "sleep_cue",
    "Targeted sleep reactivation",
    "Sparse replay of awake-bound cues with matched controls.",
    "sleep",
    "experimental"
  ),
  makeTechnique(
    "beat_lab",
    "Tonal cue namespaces",
    "Tone families for cue disambiguation.",
    "experimental",
    "speculative"
  ),
  makeTechnique(
    "audio_cue_lab",
    "Music-embedded cues",
    "Embed cues in low-arousal motifs.",
    "experimental",
    "speculative"
  )
];

export function recommendTechniques(input: {
  states: UserConceptState[];
  conceptTypes: ConceptType[];
  avoidDuskActivation?: boolean;
  limit?: number;
}): Technique[] {
  const falseConfidence =
    input.states.filter((state) => state.false_confidence_risk > 0.55).length /
    Math.max(input.states.length, 1);
  const lowTransfer =
    input.states.filter((state) => state.transfer_score < 0.5).length / Math.max(input.states.length, 1);
  return sortByScore(
    techniqueRegistry.filter((technique) =>
      technique.applicable_concept_types.some((conceptType) => input.conceptTypes.includes(conceptType))
    ),
    (technique) => {
      const evidence =
        technique.evidence_level === "strong" ? 0.35 : technique.evidence_level === "moderate" ? 0.22 : 0.1;
      const falseConfidenceFit =
        falseConfidence > 0.25 && ["failure_first", "explain_back", "compare_mode"].includes(technique.id)
          ? 0.25
          : 0;
      const transferFit =
        lowTransfer > 0.3 && ["compare_mode", "example_fade", "sketch_lock"].includes(technique.id) ? 0.2 : 0;
      const duskPenalty =
        input.avoidDuskActivation && ["smart_video", "flashread", "typography_lab"].includes(technique.id)
          ? 0.25
          : 0;
      return evidence + falseConfidenceFit + transferFit - duskPenalty;
    }
  ).slice(0, input.limit ?? 6);
}

export function createTechniqueExperiment(technique: Technique): Experiment {
  return {
    id: createId("experiment", technique.id),
    title: `${technique.name} within-user matched test`,
    experiment_type: "technique",
    hypothesis: `${technique.name} improves 24h recall, 7d recall, transfer, or calibration versus matched controls.`,
    unit_of_randomization: "concept",
    conditions: [
      { id: "technique", technique_id: technique.id },
      { id: "control", technique_id: "standard_retrieval" }
    ],
    assignment_strategy: "within_user_matched",
    metrics: [
      "immediate_recall",
      "recall_24h",
      "recall_7d",
      "transfer_score",
      "answer_latency",
      "confidence_calibration",
      "screen_efficiency",
      "user_preference"
    ],
    status: "draft",
    created_at: nowIso()
  };
}

export type ExperimentAssignment = {
  id: string;
  user_id: string;
  experiment_id: string;
  unit_id: string;
  unit_kind: "concept" | "cue";
  condition_id: string;
  technique_id?: string;
  matched_control_unit_id?: string;
  assigned_at: string;
  rationale: string[];
};

export type ExperimentConditionRollup = {
  condition_id: string;
  technique_id?: string;
  unit_kind: ExperimentAssignment["unit_kind"];
  assignments: number;
  observations: number;
  average_correctness: number;
  average_latency_ms: number;
  average_calibration: number;
  average_screen_efficiency: number;
  cue_gain_delta: number;
  effect_vs_control: number;
  recommendation: "baseline" | "collect_more_data" | "promote" | "continue" | "suppress";
};

export type ExperimentOutcomeRollup = {
  experiment_id: string;
  experiment_type: Experiment["experiment_type"];
  title: string;
  assignment_strategy: Experiment["assignment_strategy"];
  condition_rollups: ExperimentConditionRollup[];
  updated_at: string;
};

export type TechniqueResponseProfile = {
  technique_id: string;
  experiment_id: string;
  observations: number;
  effect_vs_control: number;
  recommendation: ExperimentConditionRollup["recommendation"];
};

export type ModalityResponseProfile = {
  voice_score: number;
  text_score: number;
  walking_score: number;
  video_score: number;
  flash_score: number;
  screen_efficiency_score: number;
};

export type SleepCueResponseProfile = {
  cued_observations: number;
  control_observations: number;
  cue_gain_delta: number;
  recommendation: "collect_more_data" | "continue" | "conservative" | "promote_sparse_reactivation";
};

export type PersonalizedSchedulerAdjustments = {
  morning_screen_budget_minutes: number;
  optional_watch_budgets: number[];
  evening_screen_policy: "audio_only" | "minimal_visual" | "visual_required";
  conservative_sleep: boolean;
  recommended_mode_bias: "walk" | "audio_visual" | "desk";
  rationale: string[];
};

export type PersonalizationProfile = {
  user_id: string;
  generated_at: string;
  tracked_experiment_count: number;
  active_assignment_count: number;
  technique_response: TechniqueResponseProfile[];
  sleep_cue_response: SleepCueResponseProfile;
  modality_response: ModalityResponseProfile;
  recommended_technique_ids: string[];
  suppressed_technique_ids: string[];
  scheduler_adjustments: PersonalizedSchedulerAdjustments;
};

const defaultExperimentTechniqueIds = ["spaced_retrieval", "failure_first", "walk_mode", "sleep_cue"];

export function createDefaultExperimentSuite(createdAt = nowIso()): Experiment[] {
  return defaultExperimentTechniqueIds
    .map((id) => techniqueRegistry.find((technique) => technique.id === id))
    .filter((technique): technique is Technique => Boolean(technique))
    .map((technique) => {
      const experiment = createTechniqueExperiment(technique);
      if (technique.id === "sleep_cue") {
        return {
          ...experiment,
          experiment_type: "sleep_cue",
          unit_of_randomization: "cue",
          conditions: [
            {
              id: "sparse_reactivation",
              technique_id: "sleep_cue",
              max_cues_per_hour: 8,
              control_required: true
            },
            { id: "matched_control", technique_id: "no_sleep_replay" }
          ],
          status: "running",
          created_at: createdAt
        };
      }
      return {
        ...experiment,
        conditions: [
          { id: "technique", technique_id: technique.id },
          { id: "control", technique_id: "standard_retrieval" }
        ],
        status: "running",
        created_at: createdAt
      };
    });
}

export function assignExperiments(input: {
  userId: string;
  states: UserConceptState[];
  experiments?: Experiment[];
  sleepPacket?: SleepCuePacket;
  existingAssignments?: ExperimentAssignment[];
  maxPairsPerExperiment?: number;
  assignedAt?: string;
}): ExperimentAssignment[] {
  const assignedAt = input.assignedAt ?? nowIso();
  const experiments = input.experiments?.length
    ? input.experiments
    : createDefaultExperimentSuite(assignedAt);
  const maxPairs = input.maxPairsPerExperiment ?? 2;
  const assignments = new Map(
    (input.existingAssignments ?? []).map((assignment) => [assignmentKey(assignment), assignment])
  );

  for (const experiment of experiments) {
    if (experiment.status !== "running" && experiment.status !== "draft") continue;
    if (experiment.experiment_type === "sleep_cue") {
      assignSleepCueExperiment({
        userId: input.userId,
        experiment,
        sleepPacket: input.sleepPacket,
        assignments,
        maxPairs,
        assignedAt
      });
      continue;
    }
    if (experiment.experiment_type !== "technique") continue;
    const pairs = pairMatchedConcepts(input.states, maxPairs);
    const treatmentCondition = conditionById(experiment, "technique") ?? experiment.conditions[0];
    const controlCondition = conditionById(experiment, "control") ?? experiment.conditions[1];
    if (!treatmentCondition || !controlCondition) continue;
    const treatmentId = stringField(treatmentCondition.technique_id, experiment.id);
    for (const [left, right] of pairs) {
      const flip = stableHash(`${input.userId}:${experiment.id}:${left.concept_id}:${right.concept_id}`) % 2;
      const treatment = flip === 0 ? left : right;
      const control = flip === 0 ? right : left;
      addAssignment(assignments, {
        id: createId("assignment", `${input.userId}:${experiment.id}:${treatment.concept_id}`),
        user_id: input.userId,
        experiment_id: experiment.id,
        unit_id: treatment.concept_id,
        unit_kind: "concept",
        condition_id: stringField(treatmentCondition.id, "technique"),
        technique_id: treatmentId,
        matched_control_unit_id: control.concept_id,
        assigned_at: assignedAt,
        rationale: [
          "within_user_matched",
          `matched mastery ${round(control.mastery, 2)}`,
          `control ${control.concept_id}`
        ]
      });
      addAssignment(assignments, {
        id: createId("assignment", `${input.userId}:${experiment.id}:${control.concept_id}`),
        user_id: input.userId,
        experiment_id: experiment.id,
        unit_id: control.concept_id,
        unit_kind: "concept",
        condition_id: stringField(controlCondition.id, "control"),
        technique_id: stringField(controlCondition.technique_id, "standard_retrieval"),
        matched_control_unit_id: treatment.concept_id,
        assigned_at: assignedAt,
        rationale: [
          "within_user_matched_control",
          `matched mastery ${round(treatment.mastery, 2)}`,
          `treatment ${treatment.concept_id}`
        ]
      });
    }
  }

  return [...assignments.values()].sort(
    (left, right) =>
      left.experiment_id.localeCompare(right.experiment_id) || left.unit_id.localeCompare(right.unit_id)
  );
}

export function rollupExperimentOutcomes(input: {
  experiments: Experiment[];
  assignments: ExperimentAssignment[];
  responses: AssessmentResponse[];
  events?: LearningEvent[];
  states?: UserConceptState[];
  updatedAt?: string;
}): ExperimentOutcomeRollup[] {
  const updatedAt = input.updatedAt ?? nowIso();
  const responsesByConcept = responsesByConceptId(input.responses);
  const statesByConcept = new Map((input.states ?? []).map((state) => [state.concept_id, state]));
  const events = input.events ?? [];

  return input.experiments.map((experiment) => {
    const experimentAssignments = input.assignments.filter(
      (assignment) => assignment.experiment_id === experiment.id
    );
    const controlConditionIds = new Set(
      experiment.conditions
        .map((condition) => stringField(condition.id, ""))
        .filter((id) => id.includes("control"))
    );
    const grouped = new Map<string, AssignmentObservation[]>();
    for (const assignment of experimentAssignments) {
      const observations = observationsForAssignment(assignment, responsesByConcept, events, statesByConcept);
      const entries = grouped.get(assignment.condition_id) ?? [];
      grouped.set(assignment.condition_id, [...entries, ...observations]);
      if (observations.length === 0) {
        grouped.set(assignment.condition_id, entries);
      }
    }

    const controlObservations = [...grouped.entries()]
      .filter(([conditionId]) => controlConditionIds.has(conditionId))
      .flatMap(([, observations]) => observations);
    const controlScore = average(controlObservations.map((observation) => observation.correctness));

    const conditionRollups: ExperimentConditionRollup[] = [
      ...new Set(experimentAssignments.map((a) => a.condition_id))
    ]
      .map((conditionId) => {
        const observations = grouped.get(conditionId) ?? [];
        const assignments = experimentAssignments.filter(
          (assignment) => assignment.condition_id === conditionId
        );
        const correctness = average(observations.map((observation) => observation.correctness));
        const effect =
          observations.length > 0 && controlObservations.length > 0 ? correctness - controlScore : 0;
        return {
          condition_id: conditionId,
          technique_id: assignments.find((assignment) => assignment.technique_id)?.technique_id,
          unit_kind: assignments[0]?.unit_kind ?? "concept",
          assignments: assignments.length,
          observations: observations.length,
          average_correctness: round(correctness, 3),
          average_latency_ms: Math.round(average(observations.map((observation) => observation.latencyMs))),
          average_calibration: round(average(observations.map((observation) => observation.calibration)), 3),
          average_screen_efficiency: round(
            average(observations.map((observation) => observation.screenEfficiency)),
            3
          ),
          cue_gain_delta: round(average(observations.map((observation) => observation.cueGainDelta)), 3),
          effect_vs_control: round(effect, 3),
          recommendation: recommendationFor(conditionId, observations.length, effect, controlConditionIds)
        };
      })
      .sort((left, right) => right.effect_vs_control - left.effect_vs_control);

    return {
      experiment_id: experiment.id,
      experiment_type: experiment.experiment_type,
      title: experiment.title,
      assignment_strategy: experiment.assignment_strategy,
      condition_rollups: conditionRollups,
      updated_at: updatedAt
    };
  });
}

export function buildPersonalizationProfile(input: {
  userId: string;
  experiments: Experiment[];
  assignments: ExperimentAssignment[];
  responses: AssessmentResponse[];
  events?: LearningEvent[];
  states: UserConceptState[];
  rollups?: ExperimentOutcomeRollup[];
  generatedAt?: string;
}): PersonalizationProfile {
  const generatedAt = input.generatedAt ?? nowIso();
  const rollups =
    input.rollups ??
    rollupExperimentOutcomes({
      experiments: input.experiments,
      assignments: input.assignments,
      responses: input.responses,
      events: input.events,
      states: input.states,
      updatedAt: generatedAt
    });
  const techniqueResponse = techniqueProfilesFromRollups(rollups);
  const modalityResponse = modalityProfile(input.states, input.events ?? []);
  const sleepCueResponse = sleepProfile(input.states, input.events ?? [], rollups);
  const schedulerAdjustments = schedulerAdjustmentsFor({
    modality: modalityResponse,
    sleep: sleepCueResponse,
    techniqueResponse
  });

  return {
    user_id: input.userId,
    generated_at: generatedAt,
    tracked_experiment_count: input.experiments.length,
    active_assignment_count: input.assignments.length,
    technique_response: techniqueResponse,
    sleep_cue_response: sleepCueResponse,
    modality_response: modalityResponse,
    recommended_technique_ids: techniqueResponse
      .filter((entry) => entry.recommendation === "promote")
      .map((entry) => entry.technique_id),
    suppressed_technique_ids: techniqueResponse
      .filter((entry) => entry.recommendation === "suppress")
      .map((entry) => entry.technique_id),
    scheduler_adjustments: schedulerAdjustments
  };
}

export function personalizeSessionConstraints(
  readiness: ReadinessProfile,
  profile?: PersonalizationProfile
): {
  morningScreenBudget: number;
  optionalWatchBudgets: number[];
  eveningScreenPolicy: "audio_only" | "minimal_visual" | "visual_required";
  conservativeSleep: boolean;
} {
  if (!profile) {
    return {
      morningScreenBudget: readiness.screen_budget_minutes > 20 ? 10 : 4,
      optionalWatchBudgets: [30, 18, 8],
      eveningScreenPolicy: readiness.dusk_mode ? "audio_only" : "minimal_visual",
      conservativeSleep: readiness.sleep_quality < 0.5 || readiness.fatigue > 0.7
    };
  }
  return {
    morningScreenBudget: Math.min(
      readiness.screen_budget_minutes,
      profile.scheduler_adjustments.morning_screen_budget_minutes
    ),
    optionalWatchBudgets: profile.scheduler_adjustments.optional_watch_budgets,
    eveningScreenPolicy: readiness.dusk_mode
      ? "audio_only"
      : profile.scheduler_adjustments.evening_screen_policy,
    conservativeSleep:
      profile.scheduler_adjustments.conservative_sleep ||
      readiness.sleep_quality < 0.5 ||
      readiness.fatigue > 0.7
  };
}

function makeTechnique(
  id: string,
  name: string,
  description: string,
  category: Technique["category"],
  evidence: Technique["evidence_level"],
  conceptTypes: ConceptType[] = allConceptTypes
): Technique {
  return {
    id,
    name,
    description,
    category,
    applicable_concept_types: conceptTypes,
    contraindications:
      category === "sleep"
        ? ["insomnia flare", "high emotional activation", "unsafe audio environment"]
        : category === "video"
          ? ["dusk mode", "screen budget exhausted"]
          : [],
    required_inputs: ["concept_state", "assessment_history", "goal_context"],
    outputs: ["learning_event", "graph_update", "experiment_observation"],
    default_parameters: { intensity: "adaptive", controls: true },
    user_parameter_overrides: {},
    evidence_level: evidence,
    experiment_design: { assignment: "within_user_matched", control_required: true }
  };
}

type AssignmentObservation = {
  correctness: number;
  latencyMs: number;
  calibration: number;
  screenEfficiency: number;
  cueGainDelta: number;
};

function assignSleepCueExperiment(input: {
  userId: string;
  experiment: Experiment;
  sleepPacket?: SleepCuePacket;
  assignments: Map<string, ExperimentAssignment>;
  maxPairs: number;
  assignedAt: string;
}) {
  if (!input.sleepPacket) return;
  const treatmentCondition =
    conditionById(input.experiment, "sparse_reactivation") ?? input.experiment.conditions[0];
  const controlCondition =
    conditionById(input.experiment, "matched_control") ?? input.experiment.conditions[1];
  if (!treatmentCondition || !controlCondition) return;
  const cuedIds = unique([
    ...input.sleepPacket.reactivate_concept_ids,
    ...input.sleepPacket.stabilize_concept_ids,
    ...input.sleepPacket.prime_concept_ids
  ]);
  const controlIds = unique(input.sleepPacket.control_concept_ids);
  const pairs = Math.min(cuedIds.length, controlIds.length, input.maxPairs);
  for (let index = 0; index < pairs; index += 1) {
    const cuedId = cuedIds[index];
    const controlId = controlIds[index];
    if (!cuedId || !controlId) continue;
    addAssignment(input.assignments, {
      id: createId("assignment", `${input.userId}:${input.experiment.id}:${cuedId}`),
      user_id: input.userId,
      experiment_id: input.experiment.id,
      unit_id: cuedId,
      unit_kind: "cue",
      condition_id: stringField(treatmentCondition.id, "sparse_reactivation"),
      technique_id: "sleep_cue",
      matched_control_unit_id: controlId,
      assigned_at: input.assignedAt,
      rationale: ["matched_sleep_control", `control ${controlId}`, `packet ${input.sleepPacket.id}`]
    });
    addAssignment(input.assignments, {
      id: createId("assignment", `${input.userId}:${input.experiment.id}:${controlId}`),
      user_id: input.userId,
      experiment_id: input.experiment.id,
      unit_id: controlId,
      unit_kind: "cue",
      condition_id: stringField(controlCondition.id, "matched_control"),
      technique_id: "no_sleep_replay",
      matched_control_unit_id: cuedId,
      assigned_at: input.assignedAt,
      rationale: ["matched_sleep_control_baseline", `cued ${cuedId}`, `packet ${input.sleepPacket.id}`]
    });
  }
}

function addAssignment(assignments: Map<string, ExperimentAssignment>, assignment: ExperimentAssignment) {
  const key = assignmentKey(assignment);
  if (!assignments.has(key)) assignments.set(key, assignment);
}

function assignmentKey(assignment: Pick<ExperimentAssignment, "experiment_id" | "unit_kind" | "unit_id">) {
  return `${assignment.experiment_id}:${assignment.unit_kind}:${assignment.unit_id}`;
}

function pairMatchedConcepts(
  states: UserConceptState[],
  maxPairs: number
): Array<[UserConceptState, UserConceptState]> {
  const eligible = [...states]
    .filter((state) => state.status !== "mastered" && state.status !== "unknown")
    .sort(
      (left, right) =>
        matchingScore(left) - matchingScore(right) || left.concept_id.localeCompare(right.concept_id)
    );
  const pairs: Array<[UserConceptState, UserConceptState]> = [];
  for (let index = 0; index + 1 < eligible.length && pairs.length < maxPairs; index += 2) {
    const left = eligible[index];
    const right = eligible[index + 1];
    if (left && right) pairs.push([left, right]);
  }
  return pairs;
}

function matchingScore(state: UserConceptState): number {
  return round(
    state.mastery * 0.36 +
      state.recall_strength * 0.22 +
      state.transfer_score * 0.2 +
      state.false_confidence_risk * 0.12 +
      clamp((state.answer_latency_ms ?? 30_000) / 90_000) * 0.1,
    4
  );
}

function conditionById(experiment: Experiment, id: string): Record<string, unknown> | undefined {
  return experiment.conditions.find((condition) => condition.id === id);
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function responsesByConceptId(responses: AssessmentResponse[]): Map<string, AssessmentResponse[]> {
  const byConcept = new Map<string, AssessmentResponse[]>();
  for (const response of responses) {
    for (const conceptId of conceptIdsFromResponse(response)) {
      byConcept.set(conceptId, [...(byConcept.get(conceptId) ?? []), response]);
    }
  }
  return byConcept;
}

function conceptIdsFromResponse(response: AssessmentResponse): string[] {
  return response.graph_updates
    .map((update) => update.concept_id)
    .filter((conceptId): conceptId is string => typeof conceptId === "string");
}

function observationsForAssignment(
  assignment: ExperimentAssignment,
  responsesByConcept: Map<string, AssessmentResponse[]>,
  events: LearningEvent[],
  statesByConcept: Map<string, UserConceptState>
): AssignmentObservation[] {
  if (assignment.unit_kind === "cue") {
    return sleepObservationsForAssignment(assignment, events, statesByConcept);
  }
  return (responsesByConcept.get(assignment.unit_id) ?? []).map((response) => {
    const confidence = response.confidence_reported ?? 0.5;
    return {
      correctness: response.correctness_score,
      latencyMs: response.latency_ms,
      calibration: clamp(1 - Math.abs(confidence - response.correctness_score)),
      screenEfficiency: clamp(response.correctness_score / Math.max(response.latency_ms / 60_000, 0.2)),
      cueGainDelta: 0
    };
  });
}

function sleepObservationsForAssignment(
  assignment: ExperimentAssignment,
  events: LearningEvent[],
  statesByConcept: Map<string, UserConceptState>
): AssignmentObservation[] {
  const observations: AssignmentObservation[] = [];
  for (const event of events) {
    if (event.event_type !== "graph_updated") continue;
    const payload = event.payload;
    if (payload.action !== "sleep_cue_recall_completed") continue;
    const cuedIds = stringArrayField(payload.cued_concept_ids);
    const controlIds = stringArrayField(payload.control_concept_ids);
    const isCued = cuedIds.includes(assignment.unit_id);
    const isControl = controlIds.includes(assignment.unit_id);
    if (!isCued && !isControl) continue;
    const correctness = isCued
      ? numberField(payload.average_cued_correctness, 0)
      : numberField(payload.average_control_correctness, 0);
    observations.push({
      correctness,
      latencyMs: 0,
      calibration: correctness,
      screenEfficiency: clamp(1 - numberField(payload.screen_minutes, 0) / 20),
      cueGainDelta: isCued ? numberField(payload.cue_gain_delta, 0) : 0
    });
  }
  const state = statesByConcept.get(assignment.unit_id);
  if (state && assignment.condition_id !== "matched_control") {
    observations.push({
      correctness: clamp(state.recall_strength),
      latencyMs: state.answer_latency_ms ?? 0,
      calibration: state.confidence_calibration,
      screenEfficiency: 1,
      cueGainDelta: state.cue_gain_estimate
    });
  }
  return observations;
}

function recommendationFor(
  conditionId: string,
  observations: number,
  effectVsControl: number,
  controlConditionIds: Set<string>
): ExperimentConditionRollup["recommendation"] {
  if (controlConditionIds.has(conditionId)) return "baseline";
  if (observations < 2) return "collect_more_data";
  if (effectVsControl >= 0.06) return "promote";
  if (effectVsControl <= -0.04) return "suppress";
  return "continue";
}

function techniqueProfilesFromRollups(rollups: ExperimentOutcomeRollup[]): TechniqueResponseProfile[] {
  return rollups
    .filter((rollup) => rollup.experiment_type === "technique")
    .flatMap((rollup) =>
      rollup.condition_rollups
        .filter((condition) => condition.condition_id !== "control")
        .map((condition) => ({
          technique_id: condition.technique_id ?? condition.condition_id,
          experiment_id: rollup.experiment_id,
          observations: condition.observations,
          effect_vs_control: condition.effect_vs_control,
          recommendation: condition.recommendation
        }))
    )
    .sort((left, right) => right.effect_vs_control - left.effect_vs_control);
}

function modalityProfile(states: UserConceptState[], events: LearningEvent[]): ModalityResponseProfile {
  const stateProfiles = states.map((state) => state.modality_response_profile);
  const videoStateScores = stateProfiles
    .map((profile) => numberOrUndefined(profile.video_screen_efficiency))
    .filter((value): value is number => value !== undefined);
  const flashLoads = stateProfiles
    .map((profile) => numberOrUndefined(profile.flashread_screen_load))
    .filter((value): value is number => value !== undefined);
  const flashScores = flashLoads.map((load) => clamp(1 - load));
  const videoEventScores = events
    .filter((event) => event.event_type === "video_watched")
    .map((event) =>
      event.payload.recall_passed
        ? clamp(1 - numberField(event.payload.screen_load_multiplier, 0.4))
        : clamp(0.25 - numberField(event.payload.screen_minutes, 0) / 240, 0.05)
    );
  const assessmentEvents = events.filter((event) => event.event_type === "assessment_answered");
  const voiceScores = assessmentEvents
    .filter((event) => event.payload.voice_used === true || event.payload.entry_mode === "voice")
    .map((event) => numberField(event.payload.correctness_score, 0.5));
  const textScores = assessmentEvents
    .filter((event) => event.payload.entry_mode === "text")
    .map((event) => numberField(event.payload.correctness_score, 0.5));
  const walkingScores = events
    .filter((event) => event.event_type === "walk_recall_completed")
    .map((event) => numberField(event.payload.average_correctness, 0.5));
  const videoScore = average([...videoStateScores, ...videoEventScores]);
  const flashScore = average(flashScores);
  return {
    voice_score: round(average(voiceScores), 3),
    text_score: round(average(textScores), 3),
    walking_score: round(average(walkingScores), 3),
    video_score: round(videoScore, 3),
    flash_score: round(flashScore, 3),
    screen_efficiency_score: round(average([videoScore, flashScore].filter((value) => value > 0)), 3)
  };
}

function sleepProfile(
  states: UserConceptState[],
  events: LearningEvent[],
  rollups: ExperimentOutcomeRollup[]
): SleepCueResponseProfile {
  const sleepRollup = rollups.find((rollup) => rollup.experiment_type === "sleep_cue");
  const cuedRollup = sleepRollup?.condition_rollups.find(
    (condition) => condition.condition_id === "sparse_reactivation"
  );
  const controlRollup = sleepRollup?.condition_rollups.find(
    (condition) => condition.condition_id === "matched_control"
  );
  const eventGains = events
    .filter(
      (event) => event.event_type === "graph_updated" && event.payload.action === "sleep_cue_recall_completed"
    )
    .map((event) => numberField(event.payload.cue_gain_delta, 0));
  const stateGains = states.map((state) => state.cue_gain_estimate).filter((value) => value !== 0);
  const cueGainDelta = average([
    ...(cuedRollup ? [cuedRollup.cue_gain_delta] : []),
    ...eventGains,
    ...stateGains
  ]);
  const disruptions = events.filter(
    (event) => event.event_type === "sleep_cue_played" && event.payload.sleep_disruption_reported === true
  ).length;
  return {
    cued_observations: cuedRollup?.observations ?? eventGains.length,
    control_observations: controlRollup?.observations ?? eventGains.length,
    cue_gain_delta: round(cueGainDelta, 3),
    recommendation:
      disruptions > 0 || cueGainDelta < -0.02
        ? "conservative"
        : cueGainDelta >= 0.05
          ? "promote_sparse_reactivation"
          : eventGains.length + (cuedRollup?.observations ?? 0) < 2
            ? "collect_more_data"
            : "continue"
  };
}

function schedulerAdjustmentsFor(input: {
  modality: ModalityResponseProfile;
  sleep: SleepCueResponseProfile;
  techniqueResponse: TechniqueResponseProfile[];
}): PersonalizedSchedulerAdjustments {
  const rationale: string[] = [];
  const voiceAdvantage = input.modality.voice_score - input.modality.text_score;
  const videoWeak = input.modality.video_score > 0 && input.modality.video_score < 0.42;
  const screenWeak =
    input.modality.screen_efficiency_score > 0 && input.modality.screen_efficiency_score < 0.48;
  const walkingStrong =
    input.modality.walking_score >= 0.68 ||
    input.techniqueResponse.some(
      (entry) => entry.technique_id === "walk_mode" && entry.recommendation === "promote"
    );
  if (videoWeak) rationale.push("bounded video underperformed recall controls");
  if (screenWeak) rationale.push("screen-heavy modes have weak efficiency");
  if (voiceAdvantage > 0.08) rationale.push("voice answers outperform text");
  if (walkingStrong) rationale.push("walking recall is responding well");
  if (input.sleep.recommendation === "conservative")
    rationale.push("sleep cue response requires conservative mode");
  if (input.sleep.recommendation === "promote_sparse_reactivation") {
    rationale.push("sparse sleep reactivation beat matched controls");
  }

  return {
    morning_screen_budget_minutes: walkingStrong || voiceAdvantage > 0.08 || screenWeak ? 4 : 10,
    optional_watch_budgets: videoWeak || screenWeak ? [12, 8, 5] : [30, 18, 8],
    evening_screen_policy: screenWeak || voiceAdvantage > 0.08 ? "audio_only" : "minimal_visual",
    conservative_sleep: input.sleep.recommendation === "conservative",
    recommended_mode_bias:
      walkingStrong || voiceAdvantage > 0.08 ? "walk" : screenWeak ? "desk" : "audio_visual",
    rationale: rationale.length > 0 ? rationale : ["collecting matched outcome evidence"]
  };
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
