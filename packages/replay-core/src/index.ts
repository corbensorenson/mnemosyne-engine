import { applyAssessmentToUserState } from "@mnemosyne/assessment-core";
import type {
  AssessmentResponse,
  LearningEvent,
  MasterGraph,
  UserConceptState,
  VideoAsset
} from "@mnemosyne/schema";
import { clamp, nowIso, unique } from "@mnemosyne/shared-utils";

export type ReplaySourceKind = "assessment_response" | "video_event" | "paced_read_event" | "sleep_cue_event";

export type GraphReplaySummary = {
  user_id: string;
  replayed_at: string;
  baseline_state_count: number;
  final_state_count: number;
  touched_concept_ids: string[];
  source_event_ids: string[];
  skipped_event_ids: string[];
  applied: Record<ReplaySourceKind, number>;
};

export type GraphReplayResult = GraphReplaySummary & {
  states: UserConceptState[];
};

export type ReplayUserGraphInput = {
  userId: string;
  baselineStates?: UserConceptState[];
  assessmentResponses: AssessmentResponse[];
  learningEvents: LearningEvent[];
  masterGraph?: MasterGraph;
  resetTouchedConcepts?: boolean;
  replayedAt?: string;
};

type ReplayTimelineItem =
  | { kind: "assessment_response"; at: string; id: string; response: AssessmentResponse }
  | { kind: "video_event"; at: string; id: string; event: LearningEvent }
  | { kind: "paced_read_event"; at: string; id: string; event: LearningEvent }
  | { kind: "sleep_cue_event"; at: string; id: string; event: LearningEvent };

export function replayUserGraph(input: ReplayUserGraphInput): GraphReplayResult {
  const replayedAt = input.replayedAt ?? nowIso();
  const resetTouchedConcepts = input.resetTouchedConcepts ?? true;
  const responses = input.assessmentResponses.filter((response) => response.user_id === input.userId);
  const events = input.learningEvents.filter((event) => event.user_id === input.userId);
  const touchedConceptIds = touchedConceptsFor(responses, events, input.masterGraph);
  const touchedSet = new Set(touchedConceptIds);
  const baselineStates = input.baselineStates ?? [];
  let states = resetTouchedConcepts
    ? [
        ...baselineStates.filter((state) => !touchedSet.has(state.concept_id)),
        ...touchedConceptIds.map((conceptId) => createReplayInitialState(input.userId, conceptId, replayedAt))
      ]
    : [...baselineStates];

  const skippedEventIds: string[] = [];
  const applied: Record<ReplaySourceKind, number> = {
    assessment_response: 0,
    video_event: 0,
    paced_read_event: 0,
    sleep_cue_event: 0
  };
  const timeline = buildTimeline(responses, events);

  for (const item of timeline) {
    if (item.kind === "assessment_response") {
      states = applyResponse(states, item.response, input.userId);
      applied.assessment_response += 1;
      continue;
    }
    if (item.kind === "video_event") {
      const conceptIds = conceptIdsForVideoEvent(item.event, input.masterGraph);
      if (conceptIds.length === 0) {
        skippedEventIds.push(item.id);
        continue;
      }
      states = applyVideoEvent(states, input.userId, conceptIds, item.event);
      applied.video_event += 1;
      continue;
    }
    if (item.kind === "paced_read_event") {
      const conceptIds = stringArray(item.event.payload.concept_ids);
      if (conceptIds.length === 0) {
        skippedEventIds.push(item.id);
        continue;
      }
      states = applyPacedReadEvent(states, input.userId, conceptIds, item.event);
      applied.paced_read_event += 1;
      continue;
    }
    const conceptIds = stringArray(item.event.payload.cued_concept_ids);
    if (conceptIds.length === 0) {
      skippedEventIds.push(item.id);
      continue;
    }
    states = applySleepCueEvent(states, input.userId, conceptIds, item.event);
    applied.sleep_cue_event += 1;
  }

  const sourceEventIds = timeline
    .filter((item) => item.kind !== "assessment_response" && !skippedEventIds.includes(item.id))
    .map((item) => item.id);

  return {
    user_id: input.userId,
    replayed_at: replayedAt,
    baseline_state_count: baselineStates.length,
    final_state_count: states.length,
    touched_concept_ids: touchedConceptIds,
    source_event_ids: sourceEventIds,
    skipped_event_ids: skippedEventIds,
    applied,
    states: sortStates(states)
  };
}

export function createReplayInitialState(
  userId: string,
  conceptId: string,
  createdAt = nowIso()
): UserConceptState {
  return {
    user_id: userId,
    concept_id: conceptId,
    mastery: 0.08,
    recall_strength: 0.05,
    recall_stability: 0.04,
    transfer_score: 0.04,
    answer_latency_ms: null,
    confidence_calibration: 0.5,
    false_confidence_risk: 0.18,
    prerequisite_health: 0.5,
    failure_modes: [],
    misconception_ids: [],
    next_due_at: createdAt,
    times_seen: 0,
    times_recalled: 0,
    times_failed: 0,
    hints_used: 0,
    sleep_replays: 0,
    cue_gain_estimate: 0,
    modality_response_profile: {},
    status: "unknown",
    updated_at: createdAt
  };
}

function buildTimeline(responses: AssessmentResponse[], events: LearningEvent[]): ReplayTimelineItem[] {
  const responseItems: ReplayTimelineItem[] = responses.map((response) => ({
    kind: "assessment_response",
    at: response.created_at,
    id: response.id,
    response
  }));
  const eventItems: ReplayTimelineItem[] = events.flatMap((event): ReplayTimelineItem[] => {
    if (event.event_type === "video_watched" && event.payload.recall_passed === true) {
      return [{ kind: "video_event", at: event.created_at, id: event.id, event }];
    }
    if (event.event_type === "paced_read_completed") {
      return [{ kind: "paced_read_event", at: event.created_at, id: event.id, event }];
    }
    if (event.event_type === "graph_updated" && event.payload.action === "sleep_cue_recall_completed") {
      return [{ kind: "sleep_cue_event", at: event.created_at, id: event.id, event }];
    }
    return [];
  });
  return [...responseItems, ...eventItems].sort((left, right) =>
    left.at === right.at ? left.id.localeCompare(right.id) : left.at.localeCompare(right.at)
  );
}

function touchedConceptsFor(
  responses: AssessmentResponse[],
  events: LearningEvent[],
  masterGraph: MasterGraph | undefined
): string[] {
  return unique([
    ...responses.flatMap((response) => conceptIdsForResponse(response)),
    ...events.flatMap((event) => {
      if (event.event_type === "video_watched" && event.payload.recall_passed === true) {
        return conceptIdsForVideoEvent(event, masterGraph);
      }
      if (event.event_type === "paced_read_completed") return stringArray(event.payload.concept_ids);
      if (event.event_type === "graph_updated" && event.payload.action === "sleep_cue_recall_completed") {
        return stringArray(event.payload.cued_concept_ids);
      }
      return [];
    })
  ]).sort();
}

function applyResponse(
  states: UserConceptState[],
  response: AssessmentResponse,
  userId: string
): UserConceptState[] {
  let next = [...states];
  for (const conceptId of conceptIdsForResponse(response)) {
    next = upsertState(next, userId, conceptId, (state) =>
      applyAssessmentToUserState(state, replaySafeResponse(response))
    );
  }
  return next;
}

function applyVideoEvent(
  states: UserConceptState[],
  userId: string,
  conceptIds: string[],
  event: LearningEvent
): UserConceptState[] {
  const screenMinutes = numberPayload(event.payload.screen_minutes, 0);
  const screenLoad = clamp(numberPayload(event.payload.screen_load_multiplier, screenMinutes / 60));
  return conceptIds.reduce(
    (next, conceptId) =>
      upsertState(next, userId, conceptId, (state) => ({
        ...state,
        mastery: clamp(state.mastery + 0.035),
        recall_strength: clamp(state.recall_strength + 0.045),
        recall_stability: clamp(state.recall_stability + 0.025),
        transfer_score: clamp(state.transfer_score + 0.02),
        failure_modes: state.failure_modes.filter((mode) => mode !== "video_recall_missing"),
        last_seen_at: event.created_at,
        last_correct_at: event.created_at,
        times_seen: state.times_seen + 1,
        times_recalled: state.times_recalled + 1,
        modality_response_profile: {
          ...state.modality_response_profile,
          video_recall_gate_passed: true,
          video_screen_minutes: screenMinutes,
          video_screen_load: screenLoad
        },
        status: strongerStatus(state, 0.5),
        updated_at: event.created_at
      })),
    states
  );
}

function applyPacedReadEvent(
  states: UserConceptState[],
  userId: string,
  conceptIds: string[],
  event: LearningEvent
): UserConceptState[] {
  const advanceAllowed = event.payload.advance_allowed === true;
  return conceptIds.reduce(
    (next, conceptId) =>
      upsertState(next, userId, conceptId, (state) => ({
        ...state,
        mastery: clamp(state.mastery + (advanceAllowed ? 0.045 : -0.015)),
        recall_strength: clamp(state.recall_strength + (advanceAllowed ? 0.05 : 0.005)),
        recall_stability: clamp(state.recall_stability + (advanceAllowed ? 0.025 : 0)),
        failure_modes: Array.from(
          new Set([
            ...state.failure_modes,
            ...(numberPayload(event.payload.screen_load_score, 0) > 0.58 ? ["paced_read_strain"] : []),
            ...(advanceAllowed ? [] : ["comprehension_gate_missed"])
          ])
        ).slice(-6),
        last_seen_at: event.created_at,
        times_seen: state.times_seen + 1,
        times_recalled: advanceAllowed ? state.times_recalled + 1 : state.times_recalled,
        times_failed: advanceAllowed ? state.times_failed : state.times_failed + 1,
        modality_response_profile: {
          ...state.modality_response_profile,
          paced_read_effective_wpm: numberPayload(event.payload.effective_wpm, 0),
          paced_read_screen_load: numberPayload(event.payload.screen_load_score, 0)
        },
        status: advanceAllowed ? strongerStatus(state, 0.42) : state.status,
        updated_at: event.created_at
      })),
    states
  );
}

function applySleepCueEvent(
  states: UserConceptState[],
  userId: string,
  conceptIds: string[],
  event: LearningEvent
): UserConceptState[] {
  const cueGainDelta = numberPayload(event.payload.cue_gain_delta, 0);
  return conceptIds.reduce(
    (next, conceptId) =>
      upsertState(next, userId, conceptId, (state) => ({
        ...state,
        sleep_replays: state.sleep_replays + 1,
        cue_gain_estimate: clamp(state.cue_gain_estimate * 0.72 + cueGainDelta * 0.28, -1, 1),
        best_cue_type: cueGainDelta > 0 ? "sleep_reactivation" : state.best_cue_type,
        updated_at: event.created_at
      })),
    states
  );
}

function upsertState(
  states: UserConceptState[],
  userId: string,
  conceptId: string,
  update: (state: UserConceptState) => UserConceptState
): UserConceptState[] {
  const index = states.findIndex((state) => state.concept_id === conceptId);
  const current = index >= 0 ? states[index] : createReplayInitialState(userId, conceptId);
  const updated = update(current);
  if (index < 0) return [...states, updated];
  const next = [...states];
  next[index] = updated;
  return next;
}

function conceptIdsForResponse(response: AssessmentResponse): string[] {
  return unique(
    response.graph_updates
      .map((update) => update.concept_id)
      .filter((conceptId): conceptId is string => typeof conceptId === "string" && conceptId.length > 0)
  );
}

function replaySafeResponse(response: AssessmentResponse): AssessmentResponse {
  return {
    ...response,
    correctness_score: numberPayload(response.correctness_score, 0.5),
    semantic_score: numberPayload(response.semantic_score, 0.5),
    latency_ms: numberPayload(response.latency_ms, 0),
    confidence_reported: numberPayload(response.confidence_reported, 0.5),
    hint_count: numberPayload(response.hint_count, 0),
    retries: numberPayload(response.retries, 0),
    detected_failure_modes: Array.isArray(response.detected_failure_modes)
      ? response.detected_failure_modes
      : [],
    misconception_ids: Array.isArray(response.misconception_ids) ? response.misconception_ids : []
  };
}

function conceptIdsForVideoEvent(event: LearningEvent, masterGraph: MasterGraph | undefined): string[] {
  const awarded = stringArray(event.payload.awarded_concept_ids);
  if (awarded.length > 0) return awarded;
  if (!masterGraph) return [];
  const videosById = new Map<string, VideoAsset>(masterGraph.videos.map((video) => [video.id, video]));
  return unique(
    stringArray(event.payload.video_ids).flatMap((videoId) => videosById.get(videoId)?.concept_ids ?? [])
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function numberPayload(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strongerStatus(state: UserConceptState, floor: number): UserConceptState["status"] {
  const strength = Math.max(
    floor,
    state.mastery * 0.5 + state.recall_strength * 0.3 + state.transfer_score * 0.2
  );
  if (strength >= 0.78) return "fluent";
  if (strength >= 0.62) return "known";
  if (strength >= 0.42) return "learning";
  return "fragile";
}

function sortStates(states: UserConceptState[]): UserConceptState[] {
  return [...states].sort((left, right) => left.concept_id.localeCompare(right.concept_id));
}
