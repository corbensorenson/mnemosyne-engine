import { clamp, round } from "@mnemosyne/shared-utils";

export const walkModeVoiceCommandIntents = [
  "listen",
  "repeat_prompt",
  "request_hint",
  "skip_prompt",
  "mark_confusing",
  "end_session",
  "screen_off",
  "raise_difficulty",
  "lower_difficulty",
  "explain_why",
  "score_answer",
  "next_prompt",
  "delete_transcript",
  "unknown"
] as const;

export type WalkModeVoiceCommandIntent = (typeof walkModeVoiceCommandIntents)[number];

export type WalkModePhase = "prompt" | "listening" | "feedback" | "complete";

export type WalkModeVoiceCommand = {
  schema_version: "mnemosyne-walk-voice-command-v0.1";
  raw_transcript: string;
  normalized_transcript: string;
  intent: WalkModeVoiceCommandIntent;
  canonical_command: string;
  confidence: number;
  wake_safe: boolean;
  requires_active_prompt: boolean;
  phase_allowed: boolean;
  transcript_retention_action: "none" | "delete";
  safety_flags: string[];
};

export type WalkModeVoiceCommandAuditEntry = {
  intent: WalkModeVoiceCommandIntent;
  canonical_command: string;
  confidence: number;
  wake_safe: boolean;
  safety_flags: string[];
};

export const defaultWalkModeVoiceCommands = [
  "listen",
  "repeat that",
  "score answer",
  "next prompt",
  "give hint",
  "skip",
  "mark confusing",
  "delete transcript",
  "screen off",
  "end session"
] as const;

export function parseWalkModeVoiceCommand(
  rawTranscript: string,
  input: {
    phase?: WalkModePhase;
    hasActivePrompt?: boolean;
  } = {}
): WalkModeVoiceCommand {
  const normalized = normalizeTranscript(rawTranscript);
  const matched = matchCommand(normalized);
  const phase = input.phase ?? "prompt";
  const requiresActivePrompt = requiresPrompt(matched.intent);
  const hasActivePrompt = input.hasActivePrompt ?? true;
  const phaseAllowed = commandAllowedInPhase(matched.intent, phase);
  const safetyFlags = [
    ...(matched.intent === "unknown" ? ["unrecognized_command"] : []),
    ...(requiresActivePrompt && !hasActivePrompt ? ["missing_active_prompt"] : []),
    ...(!phaseAllowed ? ["phase_blocked"] : []),
    ...(matched.intent === "end_session" && matched.confidence < 0.72 ? ["ambiguous_session_stop"] : []),
    ...(matched.intent === "delete_transcript" && matched.confidence < 0.8
      ? ["ambiguous_transcript_delete"]
      : [])
  ];
  const wakeSafe =
    matched.intent !== "unknown" &&
    (!requiresActivePrompt || hasActivePrompt) &&
    phaseAllowed &&
    !safetyFlags.some((flag) => flag.startsWith("ambiguous"));

  return {
    schema_version: "mnemosyne-walk-voice-command-v0.1",
    raw_transcript: rawTranscript,
    normalized_transcript: normalized,
    intent: matched.intent,
    canonical_command: canonicalCommandFor(matched.intent),
    confidence: matched.confidence,
    wake_safe: wakeSafe,
    requires_active_prompt: requiresActivePrompt,
    phase_allowed: phaseAllowed,
    transcript_retention_action: matched.intent === "delete_transcript" ? "delete" : "none",
    safety_flags: safetyFlags
  };
}

export function auditEntryFromWalkModeVoiceCommand(
  command: WalkModeVoiceCommand
): WalkModeVoiceCommandAuditEntry {
  return {
    intent: command.intent,
    canonical_command: command.canonical_command,
    confidence: command.confidence,
    wake_safe: command.wake_safe,
    safety_flags: command.safety_flags
  };
}

export function summarizeWalkModeVoiceCommands(
  commands: Array<WalkModeVoiceCommand | WalkModeVoiceCommandAuditEntry>
): {
  total: number;
  wake_safe: number;
  blocked: number;
  unknown: number;
  delete_transcript_requested: boolean;
  intents: Partial<Record<WalkModeVoiceCommandIntent, number>>;
  safety_flags: string[];
} {
  const intents: Partial<Record<WalkModeVoiceCommandIntent, number>> = {};
  for (const command of commands) {
    intents[command.intent] = (intents[command.intent] ?? 0) + 1;
  }
  return {
    total: commands.length,
    wake_safe: commands.filter((command) => command.wake_safe).length,
    blocked: commands.filter((command) => !command.wake_safe).length,
    unknown: commands.filter((command) => command.intent === "unknown").length,
    delete_transcript_requested: commands.some(
      (command) => command.intent === "delete_transcript" && command.wake_safe
    ),
    intents,
    safety_flags: [...new Set(commands.flatMap((command) => command.safety_flags))].sort()
  };
}

export function commandLogFromVoiceCommand(command: WalkModeVoiceCommand): string {
  return command.wake_safe
    ? command.canonical_command
    : `blocked:${command.intent}:${command.safety_flags.join("|") || "unsafe"}`;
}

function matchCommand(normalized: string): { intent: WalkModeVoiceCommandIntent; confidence: number } {
  if (!normalized) return { intent: "unknown", confidence: 0 };
  const exact = phraseMap()[normalized];
  if (exact) return { intent: exact, confidence: 1 };

  const scored = Object.entries(phraseMap())
    .map(([phrase, intent]) => ({
      intent,
      score: phraseScore(normalized, phrase)
    }))
    .sort((left, right) => right.score - left.score)[0];
  if (!scored || scored.score < 0.52) return { intent: "unknown", confidence: round(scored?.score ?? 0, 2) };
  return { intent: scored.intent, confidence: round(clamp(scored.score), 2) };
}

function phraseMap(): Record<string, WalkModeVoiceCommandIntent> {
  return {
    listen: "listen",
    "start listening": "listen",
    "begin listening": "listen",
    repeat: "repeat_prompt",
    "repeat that": "repeat_prompt",
    "say that again": "repeat_prompt",
    "replay prompt": "repeat_prompt",
    "give hint": "request_hint",
    hint: "request_hint",
    "need a hint": "request_hint",
    skip: "skip_prompt",
    "skip this": "skip_prompt",
    next: "next_prompt",
    "next prompt": "next_prompt",
    continue: "next_prompt",
    "mark confusing": "mark_confusing",
    confusing: "mark_confusing",
    "flag confusing": "mark_confusing",
    "end session": "end_session",
    "stop session": "end_session",
    "finish walk": "end_session",
    "screen off": "screen_off",
    "lock screen": "screen_off",
    "phone down": "screen_off",
    harder: "raise_difficulty",
    "more difficult": "raise_difficulty",
    "raise difficulty": "raise_difficulty",
    slower: "lower_difficulty",
    easier: "lower_difficulty",
    "lower difficulty": "lower_difficulty",
    "explain why": "explain_why",
    why: "explain_why",
    score: "score_answer",
    "score answer": "score_answer",
    "submit answer": "score_answer",
    "delete transcript": "delete_transcript",
    "delete voice transcript": "delete_transcript",
    "erase transcript": "delete_transcript"
  };
}

function canonicalCommandFor(intent: WalkModeVoiceCommandIntent): string {
  switch (intent) {
    case "listen":
      return "listen";
    case "repeat_prompt":
      return "repeat that";
    case "request_hint":
      return "give hint";
    case "skip_prompt":
      return "skip";
    case "mark_confusing":
      return "mark confusing";
    case "end_session":
      return "end session";
    case "screen_off":
      return "screen off";
    case "raise_difficulty":
      return "harder";
    case "lower_difficulty":
      return "slower";
    case "explain_why":
      return "explain why";
    case "score_answer":
      return "score answer";
    case "next_prompt":
      return "next prompt";
    case "delete_transcript":
      return "delete transcript";
    case "unknown":
      return "unknown";
  }
}

function requiresPrompt(intent: WalkModeVoiceCommandIntent): boolean {
  return [
    "listen",
    "repeat_prompt",
    "request_hint",
    "skip_prompt",
    "mark_confusing",
    "score_answer",
    "next_prompt",
    "explain_why"
  ].includes(intent);
}

function commandAllowedInPhase(intent: WalkModeVoiceCommandIntent, phase: WalkModePhase): boolean {
  if (intent === "unknown") return false;
  if (phase === "complete") return intent === "delete_transcript";
  if (intent === "score_answer") return phase === "listening" || phase === "feedback";
  if (intent === "next_prompt") return phase === "feedback" || phase === "prompt";
  return true;
}

function normalizeTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(mnemosyne|hey|please|can you|could you)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseScore(transcript: string, phrase: string): number {
  const left = new Set(transcript.split(" ").filter(Boolean));
  const right = new Set(phrase.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...right].filter((word) => left.has(word)).length;
  const precision = intersection / left.size;
  const recall = intersection / right.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}
