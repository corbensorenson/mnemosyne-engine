import {
  buildPacedReadMediaSessionPlan,
  buildSleepCueMediaSessionPlan,
  buildWalkModeMediaSessionPlan
} from "@mnemosyne/media-core";
import { describe, expect, it } from "vitest";

describe("media-core", () => {
  it("builds lock-screen safe WalkMode actions from the active prompt state", () => {
    const plan = buildWalkModeMediaSessionPlan({
      promptText: "Recall the core idea of attention routing.",
      phase: "listening",
      promptIndex: 2,
      queueLength: 5,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan).toEqual(
      expect.objectContaining({
        schema_version: "mnemosyne-learning-media-session-v0.1",
        surface: "walk_mode",
        playback_state: "playing",
        lock_screen_safe: true,
        privacy_scope: "prompt_only"
      })
    );
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ media_action: "play", command: "listen", enabled: true }),
        expect.objectContaining({ media_action: "previoustrack", command: "repeat that", enabled: true }),
        expect.objectContaining({ media_action: "stop", command: "end session", enabled: true })
      ])
    );
  });

  it("builds Paced Read media controls with progress position", () => {
    const plan = buildPacedReadMediaSessionPlan({
      title: "Attention QKV recap",
      chunkIndex: 3,
      chunkCount: 10,
      playing: false,
      rawWpm: 480,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan.surface).toBe("paced_read");
    expect(plan.playback_state).toBe("paused");
    expect(plan.position?.position_seconds).toBeGreaterThan(0);
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ media_action: "play", command: "play_paced_read", enabled: true }),
        expect.objectContaining({
          media_action: "nexttrack",
          command: "next_paced_read_chunk",
          enabled: true
        })
      ])
    );
  });

  it("builds conservative SleepCue media controls without exposing private graph detail", () => {
    const plan = buildSleepCueMediaSessionPlan({
      sleepPacketId: "sleep_packet_demo",
      playbackStatus: "playing",
      durationSeconds: 28_800,
      cueSpacingSeconds: 240,
      maxCuesPerHour: 10,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan).toEqual(
      expect.objectContaining({
        surface: "sleep_cue",
        title: "Night Reactivation",
        privacy_scope: "sleep_cue_metadata",
        playback_state: "playing"
      })
    );
    expect(plan.album).toContain("240s spacing");
    expect(JSON.stringify(plan)).not.toContain("attention_qkv");
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ media_action: "pause", command: "log_sleep_playback", enabled: true }),
        expect.objectContaining({ media_action: "stop", command: "log_sleep_playback", enabled: true })
      ])
    );
  });
});
