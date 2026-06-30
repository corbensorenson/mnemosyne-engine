import type { AssessmentItem, AssessmentResponse } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round } from "@mnemosyne/shared-utils";

export const tutorModes = [
  "socratic",
  "examiner",
  "calm_coach",
  "debate_opponent",
  "language_partner",
  "debugger",
  "oral_board",
  "walk_coach",
  "sleep_prep_guide"
] as const;
export type TutorMode = (typeof tutorModes)[number];

export type TutorIntent =
  "probe" | "hint" | "repair" | "challenge" | "summarize" | "calibrate" | "sleep_prep";

export type SemanticScoringResult = {
  semantic_score: number;
  correctness_score: number;
  required_coverage: number;
  expected_overlap: number;
  transfer_signal_coverage: number;
  matched_required_terms: string[];
  missing_required_terms: string[];
  matched_aliases: string[];
  detected_common_failures: string[];
  detected_failure_modes: string[];
  misconception_ids: string[];
  confidence_reported: number;
  calibration_delta: number;
};

export type TutorSafetyEvaluation = {
  answer_leakage_risk: number;
  hallucination_risk: number;
  unsafe_advice_risk: number;
  over_teaching_risk: number;
  flags: string[];
  blocked_terms: string[];
  requires_human_review: boolean;
  release_gate_passed: boolean;
};

export type TutorTurnPlan = {
  id: string;
  mode: TutorMode;
  intent: TutorIntent;
  response_style: string;
  feedback: string;
  next_prompt: string;
  hint: string;
  repair_steps: string[];
  allowed_next_actions: Array<
    "ask_followup" | "score_again" | "schedule_recall" | "bind_sleep_cue" | "escalate_review"
  >;
  ask_before_teach: boolean;
  compatible_assessment_event: boolean;
  transcript_policy: "deleted" | "transcript_only" | "retained";
  semantic_result: SemanticScoringResult;
  safety_evaluation: TutorSafetyEvaluation;
  created_at: string;
};

export type TutorReleaseGate = {
  turn_count: number;
  no_answer_leakage: boolean;
  no_unsafe_high_stakes_advice: boolean;
  no_hallucination_flags: boolean;
  concise_feedback: boolean;
  compatible_assessment_events: boolean;
  passed: boolean;
};

export function scoreSemanticResponse(input: {
  item: AssessmentItem;
  rawResponse: string;
  confidence?: number;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
}): SemanticScoringResult {
  const normalized = normalize(input.rawResponse);
  const expected = normalize(input.item.expected_answer ?? "");
  const requiredTerms = input.item.rubric.must_include.map(normalize).filter(Boolean);
  const aliases = input.item.rubric.acceptable_aliases.map(normalize).filter(Boolean);
  const transferSignals = input.item.rubric.transfer_signals.map(normalize).filter(Boolean);

  const matchedRequiredTerms = requiredTerms.filter((term) => includesTerm(normalized, term));
  const missingRequiredTerms = requiredTerms.filter((term) => !matchedRequiredTerms.includes(term));
  const matchedAliases = aliases.filter((alias) => includesTerm(normalized, alias));
  const detectedCommonFailures = input.item.rubric.common_failures.filter((failure) =>
    detectsCommonFailure(normalized, failure)
  );
  const requiredCoverage =
    requiredTerms.length === 0 ? 0.55 : matchedRequiredTerms.length / requiredTerms.length;
  const expectedOverlap = jaccard(keywordize(normalized), keywordize(expected));
  const transferCoverage =
    transferSignals.length === 0
      ? 0.5
      : transferSignals.filter((signal) => includesTerm(normalized, signal)).length / transferSignals.length;
  const aliasBonus = matchedAliases.length > 0 ? 0.12 : 0;
  const transferWeight = input.item.assessment_type === "transfer" ? 0.16 : 0.08;
  const semanticScore = clamp(
    requiredCoverage * 0.52 + expectedOverlap * 0.28 + transferCoverage * transferWeight + aliasBonus
  );
  const latencyPenalty = input.latencyMs > 60_000 ? 0.12 : input.latencyMs > 35_000 ? 0.06 : 0;
  const hintPenalty = (input.hintCount ?? 0) * 0.07;
  const retryPenalty = (input.retries ?? 0) * 0.04;
  const failurePenalty = detectedCommonFailures.length > 0 ? 0.08 : 0;
  const correctness = clamp(semanticScore - latencyPenalty - hintPenalty - retryPenalty - failurePenalty);
  const confidence = input.confidence ?? 0.5;
  const failureModes = classifyTutorFailureModes({
    item: input.item,
    correctness,
    semanticScore,
    confidence,
    latencyMs: input.latencyMs,
    hintCount: input.hintCount ?? 0,
    missingRequiredTerms,
    transferCoverage,
    detectedCommonFailures
  });

  return {
    semantic_score: round(semanticScore, 3),
    correctness_score: round(correctness, 3),
    required_coverage: round(requiredCoverage, 3),
    expected_overlap: round(expectedOverlap, 3),
    transfer_signal_coverage: round(transferCoverage, 3),
    matched_required_terms: matchedRequiredTerms,
    missing_required_terms: missingRequiredTerms,
    matched_aliases: matchedAliases,
    detected_common_failures: detectedCommonFailures,
    detected_failure_modes: failureModes,
    misconception_ids: failureModes.includes("dangerous_misconception")
      ? input.item.concept_ids.map((id) => `mis_${id}_tutor_false_confidence`)
      : [],
    confidence_reported: confidence,
    calibration_delta: round(1 - Math.abs(confidence - correctness), 3)
  };
}

export function buildTutorTurn(input: {
  userId: string;
  mode: TutorMode;
  item: AssessmentItem;
  rawResponse: string;
  confidence?: number;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
  transcriptPolicy?: TutorTurnPlan["transcript_policy"];
  highStakesDomain?: boolean;
  createdAt?: string;
}): TutorTurnPlan {
  const createdAt = input.createdAt ?? nowIso();
  const semantic = scoreSemanticResponse(input);
  const config = modeConfig(input.mode, semantic);
  const feedback = feedbackFor(input.mode, semantic);
  const nextPrompt = nextPromptFor(input.mode, semantic);
  const hint = hintFor(input.mode, semantic);
  const repairSteps = repairStepsFor(semantic);
  const safetyEvaluation = evaluateTutorOutput({
    item: input.item,
    draft: [feedback, nextPrompt, hint, ...repairSteps].join(" "),
    highStakesDomain: input.highStakesDomain ?? false
  });
  return {
    id: createId("tutor_turn", `${input.userId}:${input.item.id}:${input.mode}:${createdAt}`),
    mode: input.mode,
    intent: config.intent,
    response_style: config.responseStyle,
    feedback,
    next_prompt: nextPrompt,
    hint,
    repair_steps: repairSteps,
    allowed_next_actions: safetyEvaluation.requires_human_review
      ? ["escalate_review"]
      : config.allowedNextActions,
    ask_before_teach: true,
    compatible_assessment_event: true,
    transcript_policy: input.transcriptPolicy ?? "deleted",
    semantic_result: semantic,
    safety_evaluation: safetyEvaluation,
    created_at: createdAt
  };
}

export function buildAssessmentResponseFromTutorTurn(input: {
  userId: string;
  item: AssessmentItem;
  rawResponse: string;
  turn: TutorTurnPlan;
  latencyMs: number;
  hintCount?: number;
  retries?: number;
}): AssessmentResponse {
  const semantic = input.turn.semantic_result;
  return {
    id: createId("response", `${input.userId}:${input.item.id}:${input.turn.id}`),
    user_id: input.userId,
    assessment_item_id: input.item.id,
    raw_response: input.rawResponse,
    correctness_score: semantic.correctness_score,
    semantic_score: semantic.semantic_score,
    latency_ms: input.latencyMs,
    confidence_reported: semantic.confidence_reported,
    hint_count: input.hintCount ?? 0,
    retries: input.retries ?? 0,
    detected_failure_modes: semantic.detected_failure_modes,
    misconception_ids: semantic.misconception_ids,
    model_feedback: input.turn.feedback,
    graph_updates: input.item.concept_ids.map((conceptId) => ({
      concept_id: conceptId,
      mastery_delta:
        semantic.correctness_score >= 0.72 ? 0.08 : semantic.correctness_score >= 0.45 ? 0.02 : -0.05,
      calibration_delta: semantic.calibration_delta,
      latency_ms: input.latencyMs,
      tutor_mode: input.turn.mode
    })),
    created_at: input.turn.created_at
  };
}

export function evaluateTutorOutput(input: {
  item: AssessmentItem;
  draft: string;
  highStakesDomain?: boolean;
}): TutorSafetyEvaluation {
  const normalizedDraft = normalize(input.draft);
  const protectedTerms = Array.from(
    new Set([
      ...keywordize(input.item.expected_answer ?? ""),
      ...input.item.rubric.must_include.flatMap(keywordize),
      ...input.item.rubric.acceptable_aliases.flatMap(keywordize)
    ])
  ).filter((term) => term.length > 3);
  const leakedTerms = protectedTerms.filter((term) => includesTerm(normalizedDraft, term));
  const answerLeakageRisk =
    protectedTerms.length === 0 ? 0 : clamp(leakedTerms.length / Math.max(protectedTerms.length, 1));
  const hallucinationTerms = ["guaranteed", "always", "never", "proves", "cure", "diagnose", "certain"];
  const unsafeTerms = [
    "dosage",
    "prescribe",
    "legal advice",
    "weapon",
    "self harm",
    "buy options",
    "insider"
  ];
  const hallucinationHits = hallucinationTerms.filter((term) => includesTerm(normalizedDraft, term));
  const unsafeHits = unsafeTerms.filter((term) => includesTerm(normalizedDraft, term));
  const wordCount = keywordize(input.draft).length;
  const sentenceCount = input.draft.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0).length;
  const hallucinationRisk = clamp(hallucinationHits.length * 0.28);
  const unsafeAdviceRisk = clamp((input.highStakesDomain ? 0.25 : 0) + unsafeHits.length * 0.25);
  const overTeachingRisk = clamp((wordCount > 95 ? 0.45 : 0) + (sentenceCount > 6 ? 0.25 : 0));
  const flags = [
    ...(answerLeakageRisk > 0.35 ? ["answer_leakage"] : []),
    ...(hallucinationRisk > 0 ? ["hallucination_language"] : []),
    ...(unsafeAdviceRisk > 0.35 ? ["unsafe_high_stakes_advice"] : []),
    ...(overTeachingRisk > 0.4 ? ["over_teaching"] : [])
  ];
  const blockedTerms = [...leakedTerms, ...hallucinationHits, ...unsafeHits];
  const requiresHumanReview =
    answerLeakageRisk > 0.45 || hallucinationRisk > 0.55 || unsafeAdviceRisk > 0.35 || overTeachingRisk > 0.7;
  return {
    answer_leakage_risk: round(answerLeakageRisk, 3),
    hallucination_risk: round(hallucinationRisk, 3),
    unsafe_advice_risk: round(unsafeAdviceRisk, 3),
    over_teaching_risk: round(overTeachingRisk, 3),
    flags,
    blocked_terms: blockedTerms,
    requires_human_review: requiresHumanReview,
    release_gate_passed: !requiresHumanReview && flags.length === 0
  };
}

export function evaluateTutorReleaseGate(turns: TutorTurnPlan[]): TutorReleaseGate {
  const gate = {
    turn_count: turns.length,
    no_answer_leakage: turns.every((turn) => turn.safety_evaluation.answer_leakage_risk <= 0.35),
    no_unsafe_high_stakes_advice: turns.every((turn) => turn.safety_evaluation.unsafe_advice_risk <= 0.35),
    no_hallucination_flags: turns.every((turn) => turn.safety_evaluation.hallucination_risk === 0),
    concise_feedback: turns.every((turn) => turn.safety_evaluation.over_teaching_risk <= 0.4),
    compatible_assessment_events: turns.every((turn) => turn.compatible_assessment_event)
  };
  return {
    ...gate,
    passed:
      gate.turn_count > 0 &&
      gate.no_answer_leakage &&
      gate.no_unsafe_high_stakes_advice &&
      gate.no_hallucination_flags &&
      gate.concise_feedback &&
      gate.compatible_assessment_events
  };
}

function classifyTutorFailureModes(input: {
  item: AssessmentItem;
  correctness: number;
  semanticScore: number;
  confidence: number;
  latencyMs: number;
  hintCount: number;
  missingRequiredTerms: string[];
  transferCoverage: number;
  detectedCommonFailures: string[];
}): string[] {
  const failures: string[] = [];
  if (input.correctness < 0.45 && input.confidence > 0.72) failures.push("false_confidence");
  if (input.correctness < 0.35 || input.missingRequiredTerms.length > 1) failures.push("missing_core_claim");
  if (input.correctness >= 0.55 && input.latencyMs > 45_000) failures.push("slow_fragile_recall");
  if (input.hintCount > 0 && input.correctness >= 0.45) failures.push("hint_dependent");
  if (input.item.assessment_type === "transfer" && input.transferCoverage < 0.35)
    failures.push("shallow_transfer");
  if (input.detectedCommonFailures.length > 0) failures.push("known_failure_pattern");
  if (input.correctness < 0.3 && input.confidence > 0.85) failures.push("dangerous_misconception");
  return failures.length > 0 ? Array.from(new Set(failures)) : ["none"];
}

function modeConfig(
  mode: TutorMode,
  semantic: SemanticScoringResult
): {
  intent: TutorIntent;
  responseStyle: string;
  allowedNextActions: TutorTurnPlan["allowed_next_actions"];
} {
  if (mode === "sleep_prep_guide") {
    return {
      intent: "sleep_prep",
      responseStyle: "quiet cue binding",
      allowedNextActions: ["bind_sleep_cue", "schedule_recall"]
    };
  }
  if (semantic.correctness_score >= 0.72) {
    return {
      intent: mode === "debate_opponent" ? "challenge" : "calibrate",
      responseStyle: `${mode} concise advancement check`,
      allowedNextActions: ["schedule_recall", "ask_followup"]
    };
  }
  if (semantic.detected_failure_modes.includes("missing_core_claim")) {
    return {
      intent: "repair",
      responseStyle: `${mode} test-before-teach repair`,
      allowedNextActions: ["ask_followup", "score_again"]
    };
  }
  return {
    intent: "hint",
    responseStyle: `${mode} guided hint`,
    allowedNextActions: ["ask_followup", "score_again", "schedule_recall"]
  };
}

function feedbackFor(mode: TutorMode, semantic: SemanticScoringResult): string {
  if (semantic.detected_failure_modes.includes("dangerous_misconception")) {
    return "High confidence did not match the rubric. Pause advancement and repair the prerequisite.";
  }
  if (semantic.correctness_score >= 0.82) {
    return mode === "examiner"
      ? "Accepted. Now prove it transfers under pressure."
      : "Strong recall. I will raise the transfer demand before marking it stable.";
  }
  if (semantic.correctness_score >= 0.62) {
    return "Usable, but not locked. Tighten the mechanism and boundary before advancing.";
  }
  if (semantic.detected_failure_modes.includes("false_confidence")) {
    return "Your confidence is ahead of the evidence. I will ask a smaller diagnostic next.";
  }
  return "Not stable yet. I will ask before teaching, then repair one missing piece at a time.";
}

function nextPromptFor(mode: TutorMode, semantic: SemanticScoringResult): string {
  if (mode === "walk_coach") return "Keep the screen down: say the mechanism, then one boundary.";
  if (mode === "oral_board") return "Answer in one pass: mechanism, example, boundary.";
  if (mode === "debugger") return "Point to the exact step that breaks and name why.";
  if (mode === "debate_opponent") return "What is the strongest objection to your answer?";
  if (mode === "language_partner")
    return "Say it again in a shorter phrase, then translate the key relation.";
  if (mode === "sleep_prep_guide")
    return "Choose a sparse cue phrase that points to the idea without teaching it.";
  if (semantic.correctness_score >= 0.72) return "Give a new-context example without looking back.";
  return "What mechanism makes your answer true, and where would it fail?";
}

function hintFor(mode: TutorMode, semantic: SemanticScoringResult): string {
  const missingCount = semantic.missing_required_terms.length;
  if (mode === "examiner") return "No explanation yet: state the missing mechanism plainly.";
  if (mode === "calm_coach") return "Slow down. One mechanism, one example, one boundary.";
  if (mode === "sleep_prep_guide") return "Use a cue that is short, neutral, and non-activating.";
  if (missingCount > 0)
    return `You missed ${missingCount} rubric piece(s); answer with structure, not more detail.`;
  return "Keep the answer compact and test it with a boundary case.";
}

function repairStepsFor(semantic: SemanticScoringResult): string[] {
  if (semantic.correctness_score >= 0.72) {
    return ["schedule delayed recall", "ask one transfer check", "avoid adding new exposition"];
  }
  const steps = ["ask a smaller diagnostic", "require mechanism before example"];
  if (semantic.detected_failure_modes.includes("false_confidence")) steps.push("calibrate confidence first");
  if (semantic.detected_failure_modes.includes("shallow_transfer"))
    steps.push("force a new-context transfer");
  if (semantic.detected_failure_modes.includes("slow_fragile_recall"))
    steps.push("repeat after a short delay");
  return steps;
}

function detectsCommonFailure(response: string, failure: string): boolean {
  const terms = keywordize(failure);
  if (terms.length === 0) return false;
  const hits = terms.filter((term) => includesTerm(response, term)).length;
  return hits / terms.length >= 0.5;
}

function includesTerm(normalized: string, term: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(term)}($|\\s)`).test(normalized) || normalized.includes(term);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordize(value: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "that",
    "with",
    "from",
    "this",
    "into",
    "for",
    "are",
    "but",
    "one",
    "your",
    "answer"
  ]);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
