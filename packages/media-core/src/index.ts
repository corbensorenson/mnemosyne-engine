import { clamp, createId, nowIso } from "@mnemosyne/shared-utils";

export const learningMediaSessionActions = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "stop"
] as const;

export type LearningMediaSessionAction = (typeof learningMediaSessionActions)[number];
export type LearningMediaSurface = "walk_mode" | "paced_read" | "sleep_cue";

export type LearningMediaSessionPlan = {
  schema_version: "mnemosyne-learning-media-session-v0.1";
  id: string;
  surface: LearningMediaSurface;
  title: string;
  artist: string;
  album: string;
  playback_state: "none" | "paused" | "playing";
  lock_screen_safe: boolean;
  privacy_scope: "prompt_only" | "learning_content" | "sleep_cue_metadata";
  position?: {
    duration_seconds: number;
    position_seconds: number;
    playback_rate: number;
  };
  actions: LearningMediaSessionPlanAction[];
  generated_at: string;
};

export type LearningMediaSessionPlanAction = {
  media_action: LearningMediaSessionAction;
  label: string;
  command: string;
  enabled: boolean;
};

export function buildWalkModeMediaSessionPlan(input: {
  promptText?: string;
  phase: "prompt" | "listening" | "feedback" | "complete";
  promptIndex: number;
  queueLength: number;
  generatedAt?: string;
}): LearningMediaSessionPlan {
  const hasPrompt = Boolean(input.promptText) && input.phase !== "complete";
  return {
    schema_version: "mnemosyne-learning-media-session-v0.1",
    id: createId("media_session", `walk:${input.promptIndex}:${input.phase}:${input.promptText ?? "none"}`),
    surface: "walk_mode",
    title: hasPrompt
      ? `WalkMode ${input.promptIndex}/${Math.max(input.queueLength, 1)}`
      : "WalkMode complete",
    artist: "Mnemosyne WalkMode",
    album: input.promptText ? clampText(input.promptText, 72) : "Screen-locked recall",
    playback_state: input.phase === "listening" ? "playing" : input.phase === "complete" ? "none" : "paused",
    lock_screen_safe: true,
    privacy_scope: "prompt_only",
    actions: [
      action("play", "Listen", "listen", hasPrompt),
      action("pause", "Screen off", "screen off", hasPrompt),
      action("previoustrack", "Repeat", "repeat that", hasPrompt),
      action("seekbackward", "Repeat", "repeat that", hasPrompt),
      action("nexttrack", "Next", "next prompt", hasPrompt),
      action("stop", "End", "end session", input.phase !== "complete")
    ],
    generated_at: input.generatedAt ?? nowIso()
  };
}

export function buildPacedReadMediaSessionPlan(input: {
  title?: string;
  chunkIndex: number;
  chunkCount: number;
  playing: boolean;
  rawWpm: number;
  generatedAt?: string;
}): LearningMediaSessionPlan {
  const chunkCount = Math.max(1, input.chunkCount);
  const chunkIndex = clampIndex(input.chunkIndex, chunkCount);
  const secondsPerChunk = Math.max(1, Math.round((4 / Math.max(120, input.rawWpm)) * 60));
  return {
    schema_version: "mnemosyne-learning-media-session-v0.1",
    id: createId("media_session", `paced:${input.title ?? "asset"}:${chunkIndex}:${input.rawWpm}`),
    surface: "paced_read",
    title: input.title ?? "Paced Read",
    artist: "Mnemosyne Paced Read",
    album: `Chunk ${chunkIndex + 1}/${chunkCount}`,
    playback_state: input.playing ? "playing" : "paused",
    lock_screen_safe: true,
    privacy_scope: "learning_content",
    position: {
      duration_seconds: chunkCount * secondsPerChunk,
      position_seconds: chunkIndex * secondsPerChunk,
      playback_rate: Math.max(0.5, input.rawWpm / 420)
    },
    actions: [
      action("play", "Play", "play_paced_read", !input.playing),
      action("pause", "Pause", "pause_paced_read", input.playing),
      action("previoustrack", "Previous", "previous_paced_read_chunk", chunkIndex > 0),
      action("nexttrack", "Next", "next_paced_read_chunk", chunkIndex < chunkCount - 1),
      action("seekbackward", "Restart", "restart_paced_read", chunkIndex > 0),
      action("stop", "Pause", "pause_paced_read", true)
    ],
    generated_at: input.generatedAt ?? nowIso()
  };
}

export function buildSleepCueMediaSessionPlan(input: {
  sleepPacketId: string;
  playbackStatus: "idle" | "playing" | "logged";
  durationSeconds: number;
  cueSpacingSeconds: number;
  maxCuesPerHour: number;
  generatedAt?: string;
}): LearningMediaSessionPlan {
  const playing = input.playbackStatus === "playing";
  return {
    schema_version: "mnemosyne-learning-media-session-v0.1",
    id: createId("media_session", `sleep:${input.sleepPacketId}:${input.playbackStatus}`),
    surface: "sleep_cue",
    title: "Night Reactivation",
    artist: "Mnemosyne SleepCue",
    album: `${input.cueSpacingSeconds}s spacing, ${input.maxCuesPerHour}/hr max`,
    playback_state: playing ? "playing" : input.playbackStatus === "logged" ? "none" : "paused",
    lock_screen_safe: true,
    privacy_scope: "sleep_cue_metadata",
    position: {
      duration_seconds: Math.max(1, input.durationSeconds),
      position_seconds: playing ? Math.min(60, input.durationSeconds) : 0,
      playback_rate: 1
    },
    actions: [
      action("play", "Start", "start_sleep_playback", input.playbackStatus === "idle"),
      action("pause", "Log playback", "log_sleep_playback", playing),
      action("stop", "Log playback", "log_sleep_playback", playing),
      action("seekforward", "Recall check", "run_sleep_recall_check", input.playbackStatus !== "idle")
    ],
    generated_at: input.generatedAt ?? nowIso()
  };
}

function action(
  mediaAction: LearningMediaSessionAction,
  label: string,
  command: string,
  enabled: boolean
): LearningMediaSessionPlanAction {
  return {
    media_action: mediaAction,
    label,
    command,
    enabled
  };
}

function clampIndex(index: number, count: number): number {
  return Math.round(clamp(index, 0, Math.max(0, count - 1)));
}

function clampText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
