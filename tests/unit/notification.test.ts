import { buildNotificationPlan } from "@mnemosyne/notification-core";
import { buildDailyLearningPacket } from "@mnemosyne/scheduler-core";
import {
  defaultReadiness,
  demoGoals,
  demoMasterGraph,
  demoUser,
  initialUserStates
} from "@mnemosyne/demo-fixtures";
import { describe, expect, it } from "vitest";

describe("notification-core", () => {
  it("plans first-party learning reminders from packet and notification settings", () => {
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

    const plan = buildNotificationPlan({
      user: {
        ...demoUser,
        notification_settings: {
          ...demoUser.notification_settings,
          web_push_enabled: true,
          morning_prompt_at: "2026-06-30T08:15:00.000Z",
          phone_down_lead_minutes: 45
        }
      },
      packet: scheduled.packet,
      generatedAt: "2026-06-30T06:00:00.000Z"
    });

    expect(plan.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["morning_prompt", "evening_lock_in", "phone_down", "sleep_recall"])
    );
    expect(plan.items.every((item) => item.channel === "web_push_ready")).toBe(true);
    expect(plan.items.find((item) => item.kind === "morning_prompt")?.scheduled_for).toBe(
      "2026-06-30T08:15:00.000Z"
    );
    expect(plan.items.find((item) => item.kind === "phone_down")?.payload.audio_plan_id).toBe(
      scheduled.packet.sleep.audio_plan_id
    );
    expect(plan.suppressed).toHaveLength(0);
  });

  it("suppresses disabled notification kinds without losing available reminders", () => {
    const plan = buildNotificationPlan({
      user: {
        ...demoUser,
        notification_settings: {
          morning_prompt: false,
          dusk_quiet: false,
          evening_prompt: true,
          sleep_recall_prompt: false
        }
      },
      generatedAt: "2026-06-30T06:00:00.000Z"
    });

    expect(plan.items.map((item) => item.kind)).toEqual(["evening_lock_in"]);
    expect(plan.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "morning_prompt" }),
        expect.objectContaining({ kind: "phone_down" }),
        expect.objectContaining({ kind: "sleep_recall" })
      ])
    );
  });
});
