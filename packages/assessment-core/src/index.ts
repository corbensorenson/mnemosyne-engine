import type {
  AssessmentItem,
  AssessmentResponse,
  ConceptNode,
  UserConceptState
} from "@mnemosyne/schema";
import { clamp, createId, nowIso } from "@mnemosyne/shared-utils";

export type ScoringInput = {
  userId: string;
  item: AssessmentItem;
  rawResponse: string;
  confidence?: number;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
};

export function generateAssessmentForConcept(
  concept: ConceptNode,
  kind: AssessmentItem["assessment_type"] = "free_recall"
): AssessmentItem {
  const definition = concept.definitions[0] as { text?: string } | undefined;
  const expected = definition?.text ?? concept.title;
  return {
    id: createId("assessment", `${concept.id}:${kind}`),
    concept_ids: [concept.id],
    assessment_type: kind,
    prompt:
      kind === "transfer"
        ? `Apply ${concept.title} in a new scenario and name the limiting assumption.`
        : `Recall the core idea of ${concept.title}.`,
    expected_answer: expected,
    rubric: {
      must_include: keywordize(expected).slice(0, 5),
      acceptable_aliases: [concept.slug.replaceAll("-", " "), concept.title.toLowerCase()],
      common_failures: ["definition only", "example without mechanism", "confident but missing prerequisite"],
      transfer_signals: ["new context", "boundary", "why", "because"]
    },
    difficulty: concept.difficulty,
    time_limit_seconds: kind === "free_recall" ? 45 : 90,
    modality: kind === "voice_explanation" ? ["voice", "audio"] : ["text", "voice"],
    created_at: nowIso()
  };
}

export function scoreAssessmentResponse(input: ScoringInput): AssessmentResponse {
  const normalized = normalize(input.rawResponse);
  const expected = normalize(input.item.expected_answer ?? "");
  const mustInclude = input.item.rubric.must_include.map(normalize);
  const aliases = input.item.rubric.acceptable_aliases.map(normalize);

  const requiredHits =
    mustInclude.length === 0
      ? 0.5
      : mustInclude.filter((term) => normalized.includes(term)).length / mustInclude.length;
  const aliasHit = aliases.some((alias) => alias && normalized.includes(alias)) ? 0.15 : 0;
  const expectedOverlap = jaccard(keywordize(normalized), keywordize(expected));
  const semantic = clamp(requiredHits * 0.58 + expectedOverlap * 0.27 + aliasHit);
  const latencyPenalty = input.latencyMs > 60_000 ? 0.12 : input.latencyMs > 30_000 ? 0.06 : 0;
  const hintPenalty = (input.hintCount ?? 0) * 0.08;
  const retryPenalty = (input.retries ?? 0) * 0.05;
  const correctness = clamp(semantic - latencyPenalty - hintPenalty - retryPenalty);
  const confidence = input.confidence ?? 0.5;

  const failures = classifyFailureModes({
    correctness,
    semantic,
    confidence,
    latencyMs: input.latencyMs,
    hintCount: input.hintCount ?? 0
  });

  return {
    id: createId("response"),
    user_id: input.userId,
    assessment_item_id: input.item.id,
    raw_response: input.rawResponse,
    correctness_score: correctness,
    semantic_score: semantic,
    latency_ms: input.latencyMs,
    confidence_reported: confidence,
    hint_count: input.hintCount ?? 0,
    retries: input.retries ?? 0,
    detected_failure_modes: failures,
    misconception_ids: failures.includes("dangerous_misconception")
      ? input.item.concept_ids.map((id) => `mis_${id}_false_confidence`)
      : [],
    model_feedback: feedbackFor(correctness, confidence, failures),
    graph_updates: input.item.concept_ids.map((conceptId) => ({
      concept_id: conceptId,
      mastery_delta: correctness >= 0.72 ? 0.08 : correctness >= 0.45 ? 0.02 : -0.05,
      calibration_delta: 1 - Math.abs(confidence - correctness),
      latency_ms: input.latencyMs
    })),
    created_at: nowIso()
  };
}

export function applyAssessmentToUserState(
  state: UserConceptState,
  response: AssessmentResponse
): UserConceptState {
  const correctness = response.correctness_score;
  const confidence = response.confidence_reported ?? 0.5;
  const falseConfidenceRisk = correctness < 0.45 && confidence > 0.72 ? 0.18 : -0.07;
  const transferDelta = response.detected_failure_modes.includes("shallow_transfer") ? -0.04 : 0.04;
  return {
    ...state,
    mastery: clamp(state.mastery + (correctness - 0.5) * 0.16),
    recall_strength: clamp(state.recall_strength + (correctness - 0.45) * 0.18),
    recall_stability: clamp(state.recall_stability + (correctness - 0.5) * 0.08),
    transfer_score: clamp(state.transfer_score + transferDelta * correctness),
    answer_latency_ms: response.latency_ms,
    confidence_calibration: clamp(1 - Math.abs(confidence - correctness)),
    false_confidence_risk: clamp(state.false_confidence_risk + falseConfidenceRisk),
    failure_modes: Array.from(new Set([...state.failure_modes, ...response.detected_failure_modes])).slice(-6),
    misconception_ids: Array.from(new Set([...state.misconception_ids, ...response.misconception_ids])),
    last_seen_at: response.created_at,
    last_correct_at: correctness >= 0.72 ? response.created_at : state.last_correct_at,
    times_seen: state.times_seen + 1,
    times_recalled: correctness >= 0.72 ? state.times_recalled + 1 : state.times_recalled,
    times_failed: correctness < 0.45 ? state.times_failed + 1 : state.times_failed,
    hints_used: state.hints_used + response.hint_count,
    status: nextStatus(state, correctness),
    updated_at: response.created_at
  };
}

export function classifyFailureModes(input: {
  correctness: number;
  semantic: number;
  confidence: number;
  latencyMs: number;
  hintCount: number;
}): string[] {
  const failures: string[] = [];
  if (input.correctness < 0.45 && input.confidence > 0.72) failures.push("false_confidence");
  if (input.correctness < 0.35 && input.semantic < 0.35) failures.push("missing_core_claim");
  if (input.correctness >= 0.55 && input.latencyMs > 45_000) failures.push("slow_fragile_recall");
  if (input.hintCount > 0 && input.correctness >= 0.45) failures.push("hint_dependent");
  if (input.semantic >= 0.55 && input.correctness < 0.62) failures.push("shallow_transfer");
  if (input.correctness < 0.3 && input.confidence > 0.85) failures.push("dangerous_misconception");
  return failures.length > 0 ? failures : ["none"];
}

function feedbackFor(correctness: number, confidence: number, failures: string[]): string {
  if (failures.includes("dangerous_misconception")) {
    return "High confidence did not match the answer. Repair the prerequisite before advancing.";
  }
  if (failures.includes("slow_fragile_recall")) {
    return "Correct but slow. Schedule a short retrieval repeat and a transfer prompt.";
  }
  if (correctness >= 0.82 && confidence >= 0.7) return "Fluent. Raise difficulty or interleave.";
  if (correctness >= 0.62) return "Usable but not locked. Bind a cue and retest tomorrow.";
  return "Not stable yet. Test before explanation, then repair with a worked example.";
}

function nextStatus(
  state: UserConceptState,
  correctness: number
): UserConceptState["status"] {
  const projected = clamp(state.mastery + (correctness - 0.5) * 0.16);
  if (projected >= 0.86 && state.transfer_score >= 0.7) return "mastered";
  if (projected >= 0.76) return "fluent";
  if (projected >= 0.62) return "known";
  if (projected >= 0.42) return "fragile";
  if (projected >= 0.18) return "learning";
  return "previewed";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function keywordize(value: string): string[] {
  const stop = new Set(["the", "and", "that", "with", "from", "this", "into", "for", "are", "but"]);
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 2 && !stop.has(word));
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return intersection / union;
}
