import { describe, expect, it } from "vitest";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import {
  defaultReadiness,
  demoGoals,
  demoMasterGraph,
  demoUser,
  initialUserStates
} from "../../apps/web/src/data";

describe("daily scheduler", () => {
  it("builds a full daily packet with controls for sleep cue measurement", () => {
    const scheduled = buildDailyLearningPacket({
      user: demoUser,
      userGraph: { userId: demoUser.id, states: initialUserStates },
      masterGraph: demoMasterGraph,
      goals: demoGoals,
      readiness: defaultReadiness,
      constraints: {
        morningScreenBudget: 10,
        optionalWatchBudgets: [30, 18, 8],
        eveningScreenPolicy: "audio_only"
      }
    });

    expect(scheduled.packet.morning.cold_retrieval_items.length).toBeGreaterThan(0);
    expect(scheduled.packet.morning.frontier_items.length).toBeGreaterThan(0);
    expect(scheduled.packet.optional_watch_packets.length).toBe(3);
    expect(scheduled.packet.walk_packets[0].screen_policy).toBe("screen_locked");
    expect(scheduled.packet.sleep.control_concept_ids.length).toBeGreaterThan(0);
    expect(scheduled.audioPlan.layers.length).toBeGreaterThan(3);
  });
});
