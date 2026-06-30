import type { AudioPlan, SleepCueTemplate } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round } from "@mnemosyne/shared-utils";

export type RenderCue = {
  cue: SleepCueTemplate;
  label: string;
  bucket: "reactivate" | "stabilize" | "prime" | "control";
};

export type SessionSpeechSurface =
  "morning_forge" | "tutor" | "walk_mode" | "evening_lock_in" | "sleep_preview" | "speed_listen";

export type SessionSpeechPrivacyScope =
  "prompt_only" | "prompt_and_feedback" | "feedback_only" | "sleep_cue_preview" | "learning_audio";

export type SessionSpeechUtteranceRole = "prompt" | "instruction" | "feedback" | "hint" | "sleep_cue_preview";

export type SessionSpeechUtterance = {
  id: string;
  role: SessionSpeechUtteranceRole;
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  priority: number;
  speakable: boolean;
};

export type SessionSpeechPlan = {
  schema_version: "mnemosyne-session-speech-v0.1";
  id: string;
  surface: SessionSpeechSurface;
  title: string;
  privacy_scope: SessionSpeechPrivacyScope;
  network_required: false;
  browser_speech_allowed: boolean;
  raw_user_answer_included: false;
  transcript_audio_included: false;
  quiet_fallback: string[];
  utterances: SessionSpeechUtterance[];
  generated_at: string;
};

export type SpeedListenSource = {
  id: string;
  title: string;
  source_kind: "video_transcript" | "paced_read_recap" | "note";
  concept_ids: string[];
  body: string;
  duration_seconds?: number;
  cognitive_load_score?: number;
};

export type SpeedListenSessionPlan = {
  schema_version: "mnemosyne-speed-listen-session-v0.1";
  id: string;
  source_id: string;
  title: string;
  source_kind: SpeedListenSource["source_kind"];
  concept_ids: string[];
  chunks: string[];
  baseline_wpm: number;
  requested_playback_rate: number;
  effective_playback_rate: number;
  raw_listen_wpm: number;
  estimated_effective_wpm: number;
  baseline_minutes: number;
  estimated_minutes: number;
  compression_ratio: number;
  comprehension_gate: string;
  retention_check: string;
  strain_threshold: number;
  distraction_threshold: number;
  speech_plan: SessionSpeechPlan;
  created_at: string;
};

export type SpeedListenCompletionResult = {
  schema_version: "mnemosyne-speed-listen-result-v0.1";
  effective_listen_wpm: number;
  comprehension_score: number;
  retention_score: number;
  strain_rating: number;
  distraction_rating: number;
  screen_load_score: number;
  audio_load_score: number;
  advance_allowed: boolean;
  revisit_recommended: boolean;
  gate_reasons: string[];
};

export function buildMorningForgeSpeechPlan(input: {
  promptText?: string;
  promptIndex: number;
  queueLength: number;
  recommendedMode?: string;
  feedbackText?: string;
  generatedAt?: string;
}): SessionSpeechPlan {
  return buildSessionSpeechPlan({
    surface: "morning_forge",
    title: `Morning Forge ${input.promptIndex}/${Math.max(input.queueLength, 1)}`,
    privacyScope: input.feedbackText ? "prompt_and_feedback" : "prompt_only",
    seed: `forge:${input.promptIndex}:${input.promptText ?? "none"}:${input.feedbackText ?? "none"}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance("instruction", `Mode: ${input.recommendedMode ?? "retrieval"}. Answer from memory first.`, {
        rate: 0.95,
        priority: 0
      }),
      utterance("prompt", input.promptText ?? "No morning prompt is due.", { priority: 1 }),
      utterance("feedback", input.feedbackText ?? "", { rate: 0.94, priority: 2 })
    ]
  });
}

export function buildTutorSpeechPlan(input: {
  promptText?: string;
  modeLabel: string;
  gateState?: "armed" | "passed" | "held";
  feedbackText?: string;
  generatedAt?: string;
}): SessionSpeechPlan {
  return buildSessionSpeechPlan({
    surface: "tutor",
    title: `Tutor ${input.modeLabel}`,
    privacyScope: input.feedbackText ? "prompt_and_feedback" : "prompt_only",
    seed: `tutor:${input.modeLabel}:${input.promptText ?? "none"}:${input.gateState ?? "armed"}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance(
        "instruction",
        `Tutor mode: ${input.modeLabel}. Try the answer before using coaching. Gate: ${input.gateState ?? "armed"}.`,
        { rate: 0.96, priority: 0 }
      ),
      utterance("prompt", input.promptText ?? "No tutor prompt is active.", { priority: 1 }),
      utterance("feedback", input.feedbackText ?? "", { rate: 0.94, priority: 2 })
    ]
  });
}

export function buildWalkModeSpeechPlan(input: {
  promptText?: string;
  phase: "prompt" | "listening" | "feedback" | "complete";
  promptIndex: number;
  queueLength: number;
  feedbackText?: string;
  generatedAt?: string;
}): SessionSpeechPlan {
  const active = input.phase !== "complete" && Boolean(input.promptText);
  return buildSessionSpeechPlan({
    surface: "walk_mode",
    title: active ? `WalkMode ${input.promptIndex}/${Math.max(input.queueLength, 1)}` : "WalkMode complete",
    privacyScope: input.feedbackText ? "prompt_and_feedback" : "prompt_only",
    seed: `walk:${input.promptIndex}:${input.phase}:${input.promptText ?? "none"}:${input.feedbackText ?? "none"}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance("instruction", walkInstructionForPhase(input.phase), { rate: 0.96, priority: 0 }),
      utterance("prompt", input.promptText ?? "Walk session complete.", { priority: 1 }),
      utterance("feedback", input.feedbackText ?? "", { rate: 0.94, priority: 2 })
    ]
  });
}

export function buildEveningLockInSpeechPlan(input: {
  promptText?: string;
  phase?: string;
  promptIndex: number;
  queueLength: number;
  phoneDownReady: boolean;
  selectedCueCount: number;
  feedbackText?: string;
  generatedAt?: string;
}): SessionSpeechPlan {
  return buildSessionSpeechPlan({
    surface: "evening_lock_in",
    title: `Evening Lock-In ${input.promptIndex}/${Math.max(input.queueLength, 1)}`,
    privacyScope: input.feedbackText ? "prompt_and_feedback" : "prompt_only",
    seed: `evening:${input.promptIndex}:${input.phase ?? "complete"}:${input.promptText ?? "none"}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance(
        "instruction",
        `${input.phase ?? "complete"} prompt. Keep the answer short and low-screen. Phone-down is ${
          input.phoneDownReady ? "ready" : "not ready"
        }. ${input.selectedCueCount} cue${input.selectedCueCount === 1 ? "" : "s"} selected.`,
        { rate: 0.9, priority: 0 }
      ),
      utterance("prompt", input.promptText ?? "Sleep handoff ready.", { rate: 0.92, priority: 1 }),
      utterance("feedback", input.feedbackText ?? "", { rate: 0.9, priority: 2 })
    ]
  });
}

export function buildSleepCuePreviewSpeechPlan(input: {
  cueLabels: string[];
  cueSpacingSeconds: number;
  maxCuesPerHour: number;
  conservative: boolean;
  generatedAt?: string;
}): SessionSpeechPlan {
  const cueLabels = input.cueLabels
    .map((label) => clampText(label, 60))
    .filter(Boolean)
    .slice(0, 3);
  return buildSessionSpeechPlan({
    surface: "sleep_preview",
    title: "SleepCue preview",
    privacyScope: "sleep_cue_preview",
    seed: `sleep:${cueLabels.join("|")}:${input.cueSpacingSeconds}:${input.maxCuesPerHour}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance(
        "instruction",
        `Night Reactivation stays sparse: ${input.cueSpacingSeconds} second spacing, ${input.maxCuesPerHour} cues per hour max${
          input.conservative ? ", conservative mode" : ""
        }.`,
        { rate: 0.86, volume: 0.72, priority: 0 }
      ),
      ...cueLabels.map((label, index) =>
        utterance("sleep_cue_preview", label, {
          rate: 0.78,
          pitch: 0.92,
          volume: 0.56,
          priority: index + 1
        })
      )
    ]
  });
}

export function buildSpeedListenSession(
  source: SpeedListenSource,
  input: {
    requestedPlaybackRate?: number;
    baselineWpm?: number;
    generatedAt?: string;
  } = {}
): SpeedListenSessionPlan {
  const baselineWpm = input.baselineWpm ?? 155;
  const cognitiveLoad = clamp(source.cognitive_load_score ?? 0.48);
  const maxSafeRate = cognitiveLoad >= 0.7 ? 1.55 : cognitiveLoad >= 0.55 ? 1.75 : 2.05;
  const requestedRate = roundSpeechValue(input.requestedPlaybackRate ?? 1.35, 0.75, 2.2);
  const effectiveRate = roundSpeechValue(Math.min(requestedRate, maxSafeRate), 0.75, 2.2);
  const chunks = chunkSpeedListenText(source.body);
  const words = wordCount(chunks.join(" "));
  const rawListenWpm = Math.round(baselineWpm * effectiveRate);
  const comprehensionPrior = clamp(1 - cognitiveLoad * 0.34 - Math.max(0, effectiveRate - 1.35) * 0.16);
  const estimatedEffectiveWpm = Math.round(rawListenWpm * comprehensionPrior * 0.74);
  const baselineMinutes = round(words / Math.max(1, baselineWpm), 2);
  const estimatedMinutes = round(words / Math.max(1, rawListenWpm), 2);
  const speechPlan = buildSessionSpeechPlan({
    surface: "speed_listen",
    title: `SpeedListen ${source.title}`,
    privacyScope: "learning_audio",
    seed: `${source.id}:${effectiveRate}:${chunks.length}`,
    generatedAt: input.generatedAt,
    utterances: [
      utterance(
        "instruction",
        `SpeedListen at ${effectiveRate}x. Pause if strain rises. Progress counts only after comprehension and retention checks.`,
        { rate: Math.min(1.15, effectiveRate), priority: 0 }
      ),
      ...chunks.map((chunk, index) =>
        utterance("prompt", chunk, {
          rate: effectiveRate,
          priority: index + 1,
          volume: 0.86
        })
      )
    ]
  });

  return {
    schema_version: "mnemosyne-speed-listen-session-v0.1",
    id: createId("speed_listen_session", `${source.id}:${effectiveRate}:${chunks.length}`),
    source_id: source.id,
    title: source.title,
    source_kind: source.source_kind,
    concept_ids: source.concept_ids,
    chunks,
    baseline_wpm: baselineWpm,
    requested_playback_rate: requestedRate,
    effective_playback_rate: effectiveRate,
    raw_listen_wpm: rawListenWpm,
    estimated_effective_wpm: estimatedEffectiveWpm,
    baseline_minutes: baselineMinutes,
    estimated_minutes: estimatedMinutes,
    compression_ratio: round(baselineMinutes / Math.max(0.01, estimatedMinutes), 2),
    comprehension_gate: `Explain ${source.title} from memory with mechanism, example, and boundary.`,
    retention_check: "Repeat the core idea after a short delay without replaying the audio.",
    strain_threshold: 0.62,
    distraction_threshold: 0.5,
    speech_plan: speechPlan,
    created_at: input.generatedAt ?? nowIso()
  };
}

export function scoreSpeedListenCompletion(input: {
  rawListenWpm: number;
  comprehensionScore: number;
  retentionScore: number;
  strainRating: number;
  distractionRating: number;
}): SpeedListenCompletionResult {
  const comprehension = clamp(input.comprehensionScore);
  const retention = clamp(input.retentionScore);
  const strain = clamp(input.strainRating);
  const distraction = clamp(input.distractionRating);
  const gateReasons: string[] = [];
  if (comprehension < 0.72) gateReasons.push("comprehension_below_gate");
  if (retention < 0.66) gateReasons.push("retention_below_gate");
  if (strain > 0.62) gateReasons.push("strain_too_high");
  if (distraction > 0.5) gateReasons.push("distraction_too_high");
  const advanceAllowed = gateReasons.length === 0;
  const effectiveListenWpm = Math.round(input.rawListenWpm * comprehension * retention * (1 - strain * 0.18));
  return {
    schema_version: "mnemosyne-speed-listen-result-v0.1",
    effective_listen_wpm: effectiveListenWpm,
    comprehension_score: round(comprehension, 3),
    retention_score: round(retention, 3),
    strain_rating: round(strain, 3),
    distraction_rating: round(distraction, 3),
    screen_load_score: round(clamp(0.18 + strain * 0.14 + distraction * 0.12), 2),
    audio_load_score: round(clamp(0.22 + strain * 0.42 + distraction * 0.22), 2),
    advance_allowed: advanceAllowed,
    revisit_recommended: !advanceAllowed || effectiveListenWpm < input.rawListenWpm * 0.45,
    gate_reasons: gateReasons
  };
}

export function createNightAudioPlan(input: {
  userId: string;
  cues: RenderCue[];
  durationSeconds?: number;
  cueStartDelayMinutes?: number;
  cueSpacingSeconds?: number;
  maxVolume?: number;
}): AudioPlan {
  const durationSeconds = input.durationSeconds ?? 8 * 60 * 60;
  const cueStart = (input.cueStartDelayMinutes ?? 35) * 60;
  const spacing = input.cueSpacingSeconds ?? 120;
  const maxVolume = input.maxVolume ?? 0.28;
  const layers: AudioPlan["layers"] = [
    {
      id: createId("layer", "sleep-onset-ambience"),
      kind: "ambience",
      starts_at_seconds: 0,
      duration_seconds: Math.min(durationSeconds, cueStart),
      volume: maxVolume * 0.65,
      label: "sleep onset ambience"
    },
    {
      id: createId("layer", "cue-free-delay"),
      kind: "silence",
      starts_at_seconds: Math.max(60, cueStart - 120),
      duration_seconds: 120,
      volume: 0,
      label: "cue-free delay"
    }
  ];

  input.cues.forEach((entry, index) => {
    const start = cueStart + index * spacing;
    if (start >= durationSeconds - 900) return;
    layers.push({
      id: createId("layer", `${entry.cue.id}:${index}`),
      kind: entry.cue.cue_type === "tone" ? "tone" : "spoken_cue",
      starts_at_seconds: start,
      duration_seconds: Math.max(1, Math.round(entry.cue.duration_ms / 1000)),
      volume: maxVolumeForBucket(entry.bucket, maxVolume),
      label: `${entry.bucket}: ${entry.label}`
    });
    layers.push({
      id: createId("layer", `${entry.cue.id}:silence:${index}`),
      kind: "silence",
      starts_at_seconds: start + Math.max(1, Math.round(entry.cue.duration_ms / 1000)),
      duration_seconds: Math.max(12, spacing - 8),
      volume: 0,
      label: "silence spacing"
    });
  });

  layers.push({
    id: createId("layer", "late-fade"),
    kind: "fade",
    starts_at_seconds: Math.max(0, durationSeconds - 900),
    duration_seconds: 900,
    volume: 0,
    label: "late-night reduced density fade"
  });

  return {
    id: createId("audio_plan"),
    user_id: input.userId,
    duration_seconds: durationSeconds,
    layers: layers.sort((left, right) => left.starts_at_seconds - right.starts_at_seconds),
    rendered_asset_id: createId("rendered_sleep_audio"),
    render_status: "ready",
    created_at: nowIso()
  };
}

export function estimateCueDensity(plan: AudioPlan): number {
  const cueSeconds = plan.layers
    .filter((layer) => layer.kind === "spoken_cue" || layer.kind === "tone")
    .reduce((sum, layer) => sum + layer.duration_seconds, 0);
  return cueSeconds / Math.max(plan.duration_seconds, 1);
}

function maxVolumeForBucket(bucket: RenderCue["bucket"], maxVolume: number): number {
  if (bucket === "prime") return maxVolume * 0.62;
  if (bucket === "control") return maxVolume * 0.45;
  if (bucket === "stabilize") return maxVolume * 0.84;
  return maxVolume;
}

function buildSessionSpeechPlan(input: {
  surface: SessionSpeechSurface;
  title: string;
  privacyScope: SessionSpeechPrivacyScope;
  seed: string;
  utterances: SessionSpeechUtterance[];
  generatedAt?: string;
}): SessionSpeechPlan {
  const utterances = input.utterances
    .map((item) => ({
      ...item,
      text: cleanSpeechText(item.text),
      speakable: item.speakable && Boolean(cleanSpeechText(item.text))
    }))
    .filter((item) => item.text.length > 0)
    .sort((left, right) => left.priority - right.priority);
  return {
    schema_version: "mnemosyne-session-speech-v0.1",
    id: createId("speech_plan", `${input.surface}:${input.seed}`),
    surface: input.surface,
    title: input.title,
    privacy_scope: input.privacyScope,
    network_required: false,
    browser_speech_allowed: true,
    raw_user_answer_included: false,
    transcript_audio_included: false,
    quiet_fallback: utterances.map((item) => item.text),
    utterances,
    generated_at: input.generatedAt ?? nowIso()
  };
}

function utterance(
  role: SessionSpeechUtteranceRole,
  text: string,
  options: {
    rate?: number;
    pitch?: number;
    volume?: number;
    priority?: number;
    speakable?: boolean;
  } = {}
): SessionSpeechUtterance {
  return {
    id: createId("speech_utterance", `${role}:${text}:${options.priority ?? 0}`),
    role,
    text: cleanSpeechText(text),
    rate: roundSpeechValue(options.rate ?? 0.92, 0.5, 2.2),
    pitch: roundSpeechValue(options.pitch ?? 1, 0.75, 1.25),
    volume: roundSpeechValue(options.volume ?? 0.82, 0, 1),
    priority: options.priority ?? 0,
    speakable: options.speakable ?? true
  };
}

function walkInstructionForPhase(phase: "prompt" | "listening" | "feedback" | "complete"): string {
  if (phase === "listening") return "Listening. Answer from memory, then say score answer.";
  if (phase === "feedback") return "Feedback ready. Say next prompt, repeat that, or end session.";
  if (phase === "complete") return "WalkMode complete.";
  return "Prompt ready. Keep walking and recall before hints.";
}

function chunkSpeedListenText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return ["No local transcript text is available for this SpeedListen source."];
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences.length > 0 ? sentences : [clean]) {
    const words = sentence.split(" ");
    for (let index = 0; index < words.length; index += 18) {
      chunks.push(words.slice(index, index + 18).join(" "));
    }
  }
  return chunks.slice(0, 48);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function cleanSpeechText(value: string): string {
  return clampText(value.replace(/\s+/g, " ").trim(), 220);
}

function roundSpeechValue(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max) * 100) / 100;
}

function clampText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
