import {
  auditEntryFromWalkModeVoiceCommand,
  commandLogFromVoiceCommand,
  parseWalkModeVoiceCommand,
  summarizeWalkModeVoiceCommands
} from "@mnemosyne/voice-core";
import { describe, expect, it } from "vitest";

describe("voice-core", () => {
  it("maps natural WalkMode phrases to wake-safe canonical commands", () => {
    const repeat = parseWalkModeVoiceCommand("hey Mnemosyne, say that again", {
      phase: "listening",
      hasActivePrompt: true
    });
    const erase = parseWalkModeVoiceCommand("please erase transcript", {
      phase: "feedback",
      hasActivePrompt: true
    });

    expect(repeat).toEqual(
      expect.objectContaining({
        intent: "repeat_prompt",
        canonical_command: "repeat that",
        wake_safe: true
      })
    );
    expect(erase).toEqual(
      expect.objectContaining({
        intent: "delete_transcript",
        canonical_command: "delete transcript",
        transcript_retention_action: "delete",
        wake_safe: true
      })
    );
  });

  it("fails closed for unknown or phase-blocked commands", () => {
    const unknown = parseWalkModeVoiceCommand("launch the lesson cannon", {
      phase: "listening",
      hasActivePrompt: true
    });
    const scoreTooEarly = parseWalkModeVoiceCommand("score answer", {
      phase: "prompt",
      hasActivePrompt: true
    });
    const summary = summarizeWalkModeVoiceCommands([
      auditEntryFromWalkModeVoiceCommand(unknown),
      auditEntryFromWalkModeVoiceCommand(scoreTooEarly)
    ]);

    expect(unknown.wake_safe).toBe(false);
    expect(unknown.safety_flags).toContain("unrecognized_command");
    expect(commandLogFromVoiceCommand(unknown)).toContain("blocked:unknown");
    expect(scoreTooEarly.wake_safe).toBe(false);
    expect(scoreTooEarly.safety_flags).toContain("phase_blocked");
    expect(summary).toEqual(
      expect.objectContaining({
        total: 2,
        wake_safe: 0,
        blocked: 2,
        unknown: 1
      })
    );
  });
});
