import { buildOutcomeDashboard } from "@mnemosyne/outcome-core";
import type { AssessmentResponse, LearningEvent, UserConceptState } from "@mnemosyne/schema";
import { describe, expect, it } from "vitest";

const generatedAt = "2026-06-30T12:00:00.000Z";

describe("outcome-core", () => {
  it("rolls up immediate, 24h, 7d, and 30d learning quality windows", () => {
    const dashboard = buildOutcomeDashboard({
      userId: "user_demo",
      generatedAt,
      responses: [
        response("r_immediate", "attention_qkv", "2026-06-30T10:30:00.000Z", 0.82, 0.76, 22_000),
        response("r_24h", "ai_vectors", "2026-06-29T12:00:00.000Z", 0.74, 0.65, 31_000),
        response("r_7d", "transformer_blocks", "2026-06-23T12:00:00.000Z", 0.69, 0.62, 42_000),
        response("r_30d", "attention_qkv", "2026-05-31T12:00:00.000Z", 0.64, 0.58, 48_000)
      ],
      events: [
        event("e_screen", "2026-06-30T10:40:00.000Z", {
          concept_id: "attention_qkv",
          screen_minutes: 4
        }),
        event("e_sleep", "2026-06-29T12:10:00.000Z", {
          action: "sleep_cue_recall_completed",
          controls_revealed: true,
          cue_gain_delta: 0.18,
          concept_ids: ["ai_vectors"]
        })
      ],
      states: [
        state("attention_qkv", 0.72, 0.68),
        state("ai_vectors", 0.7, 0.66),
        state("transformer_blocks", 0.62, 0.59)
      ]
    });

    expect(dashboard.windows.immediate.response_count).toBe(1);
    expect(dashboard.windows["24h"].response_count).toBe(1);
    expect(dashboard.windows["7d"].response_count).toBe(1);
    expect(dashboard.windows["30d"].response_count).toBe(1);
    expect(dashboard.windows.immediate.screen_minutes).toBe(4);
    expect(dashboard.windows["24h"].sleep_cue_gain_delta).toBe(0.18);
    expect(dashboard.quality_gates).toEqual({
      immediate_recall_measured: true,
      recall_24h_measured: true,
      recall_7d_measured: true,
      recall_30d_measured: true,
      transfer_measured: true,
      latency_measured: true,
      confidence_calibration_measured: true,
      screen_load_measured: true,
      sleep_effect_measured_with_controls: true
    });
    expect(dashboard.recommendations).toEqual(["Outcome coverage is healthy; continue matched checks."]);
  });

  it("recommends missing delayed recall probes when long-window evidence is absent", () => {
    const dashboard = buildOutcomeDashboard({
      userId: "user_demo",
      generatedAt,
      responses: [response("r_immediate", "attention_qkv", "2026-06-30T10:30:00.000Z", 0.42, 0.4, 52_000)],
      events: [],
      states: [state("attention_qkv", 0.35, 0.4)]
    });

    expect(dashboard.quality_gates.recall_24h_measured).toBe(false);
    expect(dashboard.quality_gates.recall_7d_measured).toBe(false);
    expect(dashboard.quality_gates.recall_30d_measured).toBe(false);
    expect(dashboard.recommendations).toEqual(
      expect.arrayContaining([
        "Schedule 24h recall probes for active concepts.",
        "Add 7d retention checks before declaring mastery.",
        "Keep 30d follow-up prompts in the review queue.",
        "Use failure-first repair before adding harder frontier items."
      ])
    );
  });
});

function response(
  id: string,
  conceptId: string,
  createdAt: string,
  correctness: number,
  confidence: number,
  latencyMs: number
): AssessmentResponse {
  return {
    id,
    user_id: "user_demo",
    assessment_item_id: `item_${id}`,
    raw_response: "answer",
    correctness_score: correctness,
    semantic_score: correctness,
    latency_ms: latencyMs,
    confidence_reported: confidence,
    hint_count: 0,
    retries: 0,
    detected_failure_modes: [],
    misconception_ids: [],
    model_feedback: "scored",
    graph_updates: [{ concept_id: conceptId }],
    created_at: createdAt
  };
}

function event(id: string, createdAt: string, payload: Record<string, unknown>): LearningEvent {
  return {
    id,
    user_id: "user_demo",
    event_type: "graph_updated",
    payload,
    created_at: createdAt
  };
}

function state(conceptId: string, recall: number, transfer: number): UserConceptState {
  return {
    user_id: "user_demo",
    concept_id: conceptId,
    mastery: recall,
    recall_strength: recall,
    recall_stability: recall,
    transfer_score: transfer,
    answer_latency_ms: 30_000,
    confidence_calibration: 0.72,
    false_confidence_risk: 0.18,
    prerequisite_health: 0.8,
    failure_modes: [],
    misconception_ids: [],
    times_seen: 3,
    times_recalled: 2,
    times_failed: 1,
    hints_used: 0,
    sleep_replays: 0,
    cue_gain_estimate: 0,
    modality_response_profile: {},
    status: recall < 0.45 ? "decaying" : "known",
    updated_at: generatedAt
  };
}
