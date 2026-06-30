import {
  buildEveningLockInSpeechPlan,
  buildSleepCuePreviewSpeechPlan,
  buildSpeedListenSession,
  buildTutorSpeechPlan,
  buildWalkModeSpeechPlan,
  scoreSpeedListenCompletion
} from "@mnemosyne/audio-core";
import { describe, expect, it } from "vitest";

describe("audio-core session speech", () => {
  it("builds WalkMode speech plans without requiring a hosted speech API", () => {
    const plan = buildWalkModeSpeechPlan({
      promptText: "Explain why query and key vectors are compared before values are mixed.",
      phase: "prompt",
      promptIndex: 1,
      queueLength: 4,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan).toEqual(
      expect.objectContaining({
        schema_version: "mnemosyne-session-speech-v0.1",
        surface: "walk_mode",
        privacy_scope: "prompt_only",
        network_required: false,
        browser_speech_allowed: true,
        raw_user_answer_included: false,
        transcript_audio_included: false
      })
    );
    expect(plan.utterances.map((utterance) => utterance.role)).toEqual(
      expect.arrayContaining(["instruction", "prompt"])
    );
    expect(plan.quiet_fallback.join(" ")).toContain("query and key");
  });

  it("keeps tutor feedback speakable while excluding learner answers", () => {
    const plan = buildTutorSpeechPlan({
      promptText: "State the mechanism and one boundary condition.",
      modeLabel: "Oral Board",
      gateState: "passed",
      feedbackText: "Good mechanism. Add a boundary case next.",
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan.surface).toBe("tutor");
    expect(plan.privacy_scope).toBe("prompt_and_feedback");
    expect(JSON.stringify(plan)).not.toContain("my private answer");
    expect(plan.utterances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "feedback", text: "Good mechanism. Add a boundary case next." })
      ])
    );
  });

  it("summarizes Evening Lock-In as low-screen audio with a fallback transcript", () => {
    const plan = buildEveningLockInSpeechPlan({
      promptText: "Recall the two hardest concepts before phone-down.",
      phase: "recall",
      promptIndex: 2,
      queueLength: 5,
      phoneDownReady: false,
      selectedCueCount: 3,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan.surface).toBe("evening_lock_in");
    expect(plan.quiet_fallback[0]).toContain("Phone-down is not ready");
    expect(plan.utterances.every((utterance) => utterance.rate <= 1.25)).toBe(true);
  });

  it("builds conservative SleepCue preview speech without exposing graph ids", () => {
    const plan = buildSleepCuePreviewSpeechPlan({
      cueLabels: ["queries keys values", "residual path", "attention head"],
      cueSpacingSeconds: 240,
      maxCuesPerHour: 10,
      conservative: true,
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(plan).toEqual(
      expect.objectContaining({
        surface: "sleep_preview",
        privacy_scope: "sleep_cue_preview",
        network_required: false
      })
    );
    expect(plan.utterances.filter((utterance) => utterance.role === "sleep_cue_preview")).toHaveLength(3);
    expect(JSON.stringify(plan)).not.toContain("attention_qkv");
    expect(plan.quiet_fallback[0]).toContain("240 second spacing");
  });

  it("builds first-party SpeedListen sessions with bounded local speech playback", () => {
    const plan = buildSpeedListenSession(
      {
        id: "transcript_attention",
        title: "Attention recap",
        source_kind: "video_transcript",
        concept_ids: ["attention_qkv"],
        cognitive_load_score: 0.78,
        body: "Queries compare against keys to select which values matter. The output is a weighted mixture, not a stored answer. A useful boundary case is when keys are noisy."
      },
      { requestedPlaybackRate: 2.1, generatedAt: "2026-06-30T12:00:00.000Z" }
    );

    expect(plan).toEqual(
      expect.objectContaining({
        schema_version: "mnemosyne-speed-listen-session-v0.1",
        source_id: "transcript_attention",
        source_kind: "video_transcript"
      })
    );
    expect(plan.effective_playback_rate).toBeLessThan(2.1);
    expect(plan.speech_plan).toEqual(
      expect.objectContaining({
        surface: "speed_listen",
        privacy_scope: "learning_audio",
        network_required: false
      })
    );
    expect(Math.max(...plan.speech_plan.utterances.map((utterance) => utterance.rate))).toBe(
      plan.effective_playback_rate
    );
    expect(plan.chunks.length).toBeGreaterThan(0);
    expect(plan.comprehension_gate).toContain("Attention recap");
  });

  it("scores SpeedListen progress by comprehension, retention, strain, and distraction", () => {
    const passed = scoreSpeedListenCompletion({
      rawListenWpm: 248,
      comprehensionScore: 0.84,
      retentionScore: 0.76,
      strainRating: 0.28,
      distractionRating: 0.18
    });
    const held = scoreSpeedListenCompletion({
      rawListenWpm: 300,
      comprehensionScore: 0.66,
      retentionScore: 0.6,
      strainRating: 0.7,
      distractionRating: 0.55
    });

    expect(passed.advance_allowed).toBe(true);
    expect(passed.gate_reasons).toEqual([]);
    expect(passed.effective_listen_wpm).toBeGreaterThan(100);
    expect(held.advance_allowed).toBe(false);
    expect(held.gate_reasons).toEqual(
      expect.arrayContaining([
        "comprehension_below_gate",
        "retention_below_gate",
        "strain_too_high",
        "distraction_too_high"
      ])
    );
  });
});
