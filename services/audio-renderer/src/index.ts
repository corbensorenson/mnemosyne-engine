import type { AudioPlan } from "@mnemosyne/schema";

export type RenderManifest = {
  audio_plan_id: string;
  duration_seconds: number;
  chapters: Array<{
    starts_at_seconds: number;
    duration_seconds: number;
    label: string;
    volume: number;
  }>;
  output_format: "m4a" | "mp3" | "wav";
};

export function buildRenderManifest(
  plan: AudioPlan,
  outputFormat: RenderManifest["output_format"] = "m4a"
): RenderManifest {
  return {
    audio_plan_id: plan.id,
    duration_seconds: plan.duration_seconds,
    chapters: plan.layers.map((layer) => ({
      starts_at_seconds: layer.starts_at_seconds,
      duration_seconds: layer.duration_seconds,
      label: layer.label,
      volume: layer.volume
    })),
    output_format: outputFormat
  };
}
