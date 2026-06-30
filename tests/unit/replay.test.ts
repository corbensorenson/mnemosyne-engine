import { createReplayInitialState, replayUserGraph } from "@mnemosyne/replay-core";
import type { AssessmentResponse, LearningEvent } from "@mnemosyne/schema";
import { describe, expect, it } from "vitest";

describe("replay-core", () => {
  it("rebuilds touched concept state from assessment responses and replayable events", () => {
    const response = assessmentResponse("response_replay", "attention_qkv", "2026-06-30T10:00:00.000Z");
    const videoEvent: LearningEvent = {
      id: "event_video_replay",
      user_id: "user_replay",
      event_type: "video_watched",
      payload: {
        recall_passed: true,
        awarded_concept_ids: ["ai_vectors"],
        screen_minutes: 6,
        screen_load_multiplier: 0.3
      },
      created_at: "2026-06-30T11:00:00.000Z"
    };
    const speedListenEvent: LearningEvent = {
      id: "event_speed_listen_replay",
      user_id: "user_replay",
      event_type: "speed_listen_completed",
      payload: {
        concept_ids: ["transformer_blocks"],
        advance_allowed: true,
        gate_reasons: [],
        comprehension_score: 0.84,
        retention_score: 0.76,
        effective_listen_wpm: 151,
        audio_load_score: 0.35,
        distraction_rating: 0.16
      },
      created_at: "2026-06-30T12:00:00.000Z"
    };
    const sleepEvent: LearningEvent = {
      id: "event_sleep_replay",
      user_id: "user_replay",
      event_type: "graph_updated",
      payload: {
        action: "sleep_cue_recall_completed",
        cued_concept_ids: ["attention_qkv"],
        cue_gain_delta: 0.2
      },
      created_at: "2026-07-01T07:00:00.000Z"
    };
    const staleState = {
      ...createReplayInitialState("user_replay", "attention_qkv", "2026-06-29T00:00:00.000Z"),
      times_seen: 99,
      mastery: 0,
      sleep_replays: 0
    };

    const replay = replayUserGraph({
      userId: "user_replay",
      baselineStates: [staleState],
      assessmentResponses: [response],
      learningEvents: [videoEvent, speedListenEvent, sleepEvent],
      replayedAt: "2026-07-01T08:00:00.000Z"
    });

    const attention = replay.states.find((state) => state.concept_id === "attention_qkv");
    const vectors = replay.states.find((state) => state.concept_id === "ai_vectors");
    const transformer = replay.states.find((state) => state.concept_id === "transformer_blocks");
    expect(replay.applied).toEqual({
      assessment_response: 1,
      video_event: 1,
      paced_read_event: 0,
      speed_listen_event: 1,
      sleep_cue_event: 1
    });
    expect(replay.touched_concept_ids).toEqual(["ai_vectors", "attention_qkv", "transformer_blocks"]);
    expect(attention?.times_seen).toBe(1);
    expect(attention?.sleep_replays).toBe(1);
    expect(attention?.mastery).toBeGreaterThan(0.08);
    expect(vectors?.times_recalled).toBe(1);
    expect(vectors?.modality_response_profile.video_recall_gate_passed).toBe(true);
    expect(transformer?.times_recalled).toBe(1);
    expect(transformer?.modality_response_profile.speed_listen_effective_wpm).toBe(151);
  });
});

function assessmentResponse(id: string, conceptId: string, createdAt: string): AssessmentResponse {
  return {
    id,
    user_id: "user_replay",
    assessment_item_id: `item_${id}`,
    raw_response: "durable answer",
    correctness_score: 0.84,
    semantic_score: 0.8,
    latency_ms: 18_000,
    confidence_reported: 0.78,
    hint_count: 0,
    retries: 0,
    detected_failure_modes: [],
    misconception_ids: [],
    model_feedback: "replay response",
    graph_updates: [{ concept_id: conceptId }],
    created_at: createdAt
  };
}
