import type { AssessmentResponse, LearningEvent, UserConceptState } from "@mnemosyne/schema";
import { clamp, nowIso, round, unique } from "@mnemosyne/shared-utils";

export type OutcomeWindow = "immediate" | "24h" | "7d" | "30d";

export type OutcomeWindowDefinition = {
  id: OutcomeWindow;
  label: string;
  min_age_hours: number;
  max_age_hours: number;
};

export type OutcomeWindowRollup = {
  window: OutcomeWindow;
  label: string;
  min_age_hours: number;
  max_age_hours: number;
  response_count: number;
  concept_count: number;
  average_correctness: number;
  average_semantic_score: number;
  average_latency_ms: number;
  confidence_calibration_error: number;
  transfer_score: number;
  retention_score: number;
  screen_minutes: number;
  sleep_cue_gain_delta: number;
  evidence_response_ids: string[];
  evidence_event_ids: string[];
};

export type OutcomeQualityGates = {
  immediate_recall_measured: boolean;
  recall_24h_measured: boolean;
  recall_7d_measured: boolean;
  recall_30d_measured: boolean;
  transfer_measured: boolean;
  latency_measured: boolean;
  confidence_calibration_measured: boolean;
  screen_load_measured: boolean;
  sleep_effect_measured_with_controls: boolean;
};

export type OutcomeDashboard = {
  user_id: string;
  generated_at: string;
  windows: Record<OutcomeWindow, OutcomeWindowRollup>;
  quality_gates: OutcomeQualityGates;
  durable_mastery: number;
  retention_risk: number;
  learning_velocity: number;
  cue_gain_delta: number;
  recommendations: string[];
};

export const defaultOutcomeWindows: OutcomeWindowDefinition[] = [
  { id: "immediate", label: "Immediate", min_age_hours: 0, max_age_hours: 4 },
  { id: "24h", label: "24h", min_age_hours: 20, max_age_hours: 36 },
  { id: "7d", label: "7d", min_age_hours: 24 * 6, max_age_hours: 24 * 8 },
  { id: "30d", label: "30d", min_age_hours: 24 * 27, max_age_hours: 24 * 33 }
];

export function buildOutcomeDashboard(input: {
  userId: string;
  responses: AssessmentResponse[];
  events: LearningEvent[];
  states: UserConceptState[];
  generatedAt?: string;
  windows?: OutcomeWindowDefinition[];
}): OutcomeDashboard {
  const generatedAt = input.generatedAt ?? nowIso();
  const windows = input.windows ?? defaultOutcomeWindows;
  const rollups = Object.fromEntries(
    windows.map((window) => [
      window.id,
      buildWindowRollup({
        window,
        generatedAt,
        responses: input.responses,
        events: input.events,
        states: input.states
      })
    ])
  ) as Record<OutcomeWindow, OutcomeWindowRollup>;
  const qualityGates = qualityGatesFor(rollups, input.events);
  const durableMastery = average(
    input.states.map((state) => state.mastery * 0.5 + state.transfer_score * 0.5)
  );
  const retentionRisk = clamp(
    input.states.filter((state) => state.status === "decaying" || state.recall_strength < 0.45).length /
      Math.max(input.states.length, 1)
  );
  const learningVelocity = round(
    Object.values(rollups).reduce(
      (sum, rollup) => sum + rollup.average_correctness * rollup.response_count,
      0
    ) /
      Math.max(
        Object.values(rollups).reduce((sum, rollup) => sum + rollup.response_count, 0),
        1
      ),
    3
  );
  const cueGainDelta = round(average(Object.values(rollups).map((rollup) => rollup.sleep_cue_gain_delta)), 3);
  return {
    user_id: input.userId,
    generated_at: generatedAt,
    windows: rollups,
    quality_gates: qualityGates,
    durable_mastery: round(durableMastery, 3),
    retention_risk: round(retentionRisk, 3),
    learning_velocity: learningVelocity,
    cue_gain_delta: cueGainDelta,
    recommendations: recommendationsFor(rollups, qualityGates, retentionRisk)
  };
}

function buildWindowRollup(input: {
  window: OutcomeWindowDefinition;
  generatedAt: string;
  responses: AssessmentResponse[];
  events: LearningEvent[];
  states: UserConceptState[];
}): OutcomeWindowRollup {
  const responses = input.responses.filter((response) =>
    isInAgeWindow(response.created_at, input.generatedAt, input.window)
  );
  const events = input.events.filter((event) =>
    isInAgeWindow(event.created_at, input.generatedAt, input.window)
  );
  const conceptIds = unique([
    ...responses.flatMap((response) => responseConceptIds(response)),
    ...events.flatMap((event) => eventConceptIds(event))
  ]);
  const conceptStates = input.states.filter((state) => conceptIds.includes(state.concept_id));
  return {
    window: input.window.id,
    label: input.window.label,
    min_age_hours: input.window.min_age_hours,
    max_age_hours: input.window.max_age_hours,
    response_count: responses.length,
    concept_count: conceptIds.length,
    average_correctness: round(average(responses.map((response) => response.correctness_score)), 3),
    average_semantic_score: round(average(responses.map((response) => response.semantic_score)), 3),
    average_latency_ms: Math.round(average(responses.map((response) => response.latency_ms))),
    confidence_calibration_error: round(
      average(
        responses
          .filter((response) => response.confidence_reported !== undefined)
          .map((response) => Math.abs(response.correctness_score - (response.confidence_reported ?? 0)))
      ),
      3
    ),
    transfer_score: round(average(conceptStates.map((state) => state.transfer_score)), 3),
    retention_score: round(average(conceptStates.map((state) => state.recall_strength)), 3),
    screen_minutes: round(sum(events.map((event) => numericPayload(event.payload, "screen_minutes"))), 2),
    sleep_cue_gain_delta: round(
      average(events.map((event) => numericPayload(event.payload, "cue_gain_delta"))),
      3
    ),
    evidence_response_ids: responses.map((response) => response.id),
    evidence_event_ids: events.map((event) => event.id)
  };
}

function qualityGatesFor(
  rollups: Record<OutcomeWindow, OutcomeWindowRollup>,
  events: LearningEvent[]
): OutcomeQualityGates {
  return {
    immediate_recall_measured: rollups.immediate.response_count > 0,
    recall_24h_measured: rollups["24h"].response_count > 0,
    recall_7d_measured: rollups["7d"].response_count > 0,
    recall_30d_measured: rollups["30d"].response_count > 0,
    transfer_measured: Object.values(rollups).some((rollup) => rollup.transfer_score > 0),
    latency_measured: Object.values(rollups).some((rollup) => rollup.average_latency_ms > 0),
    confidence_calibration_measured: Object.values(rollups).some(
      (rollup) => rollup.confidence_calibration_error > 0
    ),
    screen_load_measured: Object.values(rollups).some((rollup) => rollup.screen_minutes > 0),
    sleep_effect_measured_with_controls: events.some(
      (event) =>
        event.payload.action === "sleep_cue_recall_completed" ||
        event.payload.controls_revealed === true ||
        typeof event.payload.cue_gain_delta === "number"
    )
  };
}

function recommendationsFor(
  rollups: Record<OutcomeWindow, OutcomeWindowRollup>,
  gates: OutcomeQualityGates,
  retentionRisk: number
): string[] {
  const recommendations: string[] = [];
  if (!gates.recall_24h_measured) recommendations.push("Schedule 24h recall probes for active concepts.");
  if (!gates.recall_7d_measured) recommendations.push("Add 7d retention checks before declaring mastery.");
  if (!gates.recall_30d_measured) recommendations.push("Keep 30d follow-up prompts in the review queue.");
  if (!gates.sleep_effect_measured_with_controls) {
    recommendations.push("Run matched cued versus uncued SleepCue recall before claiming sleep lift.");
  }
  if (retentionRisk > 0.35) recommendations.push("Increase retrieval spacing for decaying concepts.");
  if (rollups.immediate.average_correctness < 0.55 && rollups.immediate.response_count > 0) {
    recommendations.push("Use failure-first repair before adding harder frontier items.");
  }
  if (recommendations.length === 0)
    recommendations.push("Outcome coverage is healthy; continue matched checks.");
  return recommendations;
}

function isInAgeWindow(createdAt: string, generatedAt: string, window: OutcomeWindowDefinition): boolean {
  const created = Date.parse(createdAt);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(generated) || created > generated) return false;
  const ageHours = (generated - created) / 3_600_000;
  return ageHours >= window.min_age_hours && ageHours <= window.max_age_hours;
}

function responseConceptIds(response: AssessmentResponse): string[] {
  return unique(
    response.graph_updates
      .map((update) => (typeof update.concept_id === "string" ? update.concept_id : undefined))
      .filter((conceptId): conceptId is string => Boolean(conceptId))
  );
}

function eventConceptIds(event: LearningEvent): string[] {
  const single = typeof event.payload.concept_id === "string" ? [event.payload.concept_id] : [];
  const multiple = Array.isArray(event.payload.concept_ids)
    ? event.payload.concept_ids.filter((conceptId): conceptId is string => typeof conceptId === "string")
    : [];
  return unique([...single, ...multiple]);
}

function numericPayload(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
