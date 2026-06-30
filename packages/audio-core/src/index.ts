import type { AudioPlan, SleepCueTemplate } from "@mnemosyne/schema";
import { createId, nowIso } from "@mnemosyne/shared-utils";

export type RenderCue = {
  cue: SleepCueTemplate;
  label: string;
  bucket: "reactivate" | "stabilize" | "prime" | "control";
};

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
