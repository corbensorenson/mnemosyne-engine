import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import {
  demoGoals,
  demoMasterGraph,
  demoUser,
  initialUserStates,
  defaultReadiness
} from "@mnemosyne/demo-fixtures";
import { describe, expect, it } from "vitest";
import { audioPreviewForPacket, scheduleFromPersistedPacket } from "../../apps/web/src/bootstrapState";

const fallback = buildDailyLearningPacket({
  user: demoUser,
  userGraph: { userId: demoUser.id, states: initialUserStates },
  masterGraph: demoMasterGraph,
  goals: demoGoals,
  readiness: defaultReadiness,
  constraints: {
    morningScreenBudget: 10,
    optionalWatchBudgets: [20, 12],
    eveningScreenPolicy: "minimal_visual",
    conservativeSleep: false
  }
});

const persistedPacket = {
  ...fallback.packet,
  id: "daily_packet_persisted",
  sleep: {
    ...fallback.packet.sleep,
    audio_plan_id: "audio_plan_persisted",
    reactivate_concept_ids: ["attention_qkv"],
    stabilize_concept_ids: ["ai_vectors"],
    prime_concept_ids: ["transformer_blocks"],
    max_cues_per_hour: 2,
    cue_spacing_seconds: 240
  }
};

describe("web bootstrap state", () => {
  it("uses the persisted daily packet and matching persisted audio plan", () => {
    const persistedAudioPlan = {
      ...fallback.audioPlan,
      id: persistedPacket.sleep.audio_plan_id,
      user_id: persistedPacket.user_id,
      render_status: "ready" as const
    };

    const scheduled = scheduleFromPersistedPacket(persistedPacket, persistedAudioPlan, fallback);

    expect(scheduled.packet.id).toBe("daily_packet_persisted");
    expect(scheduled.audioPlan.id).toBe("audio_plan_persisted");
    expect(scheduled.audioPlan.render_status).toBe("ready");
    expect(scheduled.audioPlan).toBe(persistedAudioPlan);
  });

  it("derives a matching first-party audio preview when the persisted plan is missing", () => {
    const scheduled = scheduleFromPersistedPacket(persistedPacket, undefined, fallback);

    expect(scheduled.audioPlan.id).toBe("audio_plan_persisted");
    expect(scheduled.audioPlan.user_id).toBe(persistedPacket.user_id);
    expect(scheduled.audioPlan.layers.some((layer) => layer.label === "attention qkv")).toBe(true);
    expect(scheduled.audioPlan.layers.filter((layer) => layer.kind === "spoken_cue")).toHaveLength(2);
  });

  it("preserves the local schedule when no persisted packet is available", () => {
    expect(scheduleFromPersistedPacket(undefined, undefined, fallback)).toBe(fallback);
  });

  it("keeps derived preview duration long enough for sparse cue spacing", () => {
    const preview = audioPreviewForPacket({
      ...fallback.packet,
      sleep: {
        ...fallback.packet.sleep,
        audio_plan_id: "audio_plan_sparse",
        target_sleep_window: {
          ...fallback.packet.sleep.target_sleep_window,
          cue_start_delay_minutes: 30
        },
        cue_spacing_seconds: 600,
        reactivate_concept_ids: ["a", "b"],
        stabilize_concept_ids: [],
        prime_concept_ids: []
      }
    });

    expect(preview.duration_seconds).toBeGreaterThanOrEqual(30 * 60 + 600);
    expect(preview.layers[0]).toEqual(expect.objectContaining({ kind: "ambience" }));
  });
});
