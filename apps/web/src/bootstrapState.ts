import type { ScheduledDay } from "@mnemosyne/scheduler-core";
import type { AudioPlan, DailyLearningPacket } from "@mnemosyne/schema";

export function scheduleFromPersistedPacket(
  packet: DailyLearningPacket | null | undefined,
  fallback: ScheduledDay
): ScheduledDay {
  if (!packet) return fallback;
  return {
    packet,
    audioPlan: audioPreviewForPacket(packet, fallback.audioPlan)
  };
}

export function audioPreviewForPacket(packet: DailyLearningPacket, fallback?: AudioPlan): AudioPlan {
  const cueIds = [
    ...packet.sleep.reactivate_concept_ids,
    ...packet.sleep.stabilize_concept_ids,
    ...packet.sleep.prime_concept_ids
  ];
  const startAt = Math.max(0, packet.sleep.target_sleep_window.cue_start_delay_minutes * 60);
  const spacing = Math.max(60, packet.sleep.cue_spacing_seconds);
  const cueLayers = cueIds.slice(0, Math.max(1, packet.sleep.max_cues_per_hour)).map((conceptId, index) => ({
    id: `${packet.sleep.audio_plan_id}:cue:${index}`,
    kind: "spoken_cue" as const,
    starts_at_seconds: startAt + index * spacing,
    duration_seconds: 4,
    volume: packet.sleep.max_volume,
    label: labelFromConceptId(conceptId)
  }));
  const fallbackLayers = fallback?.layers ?? [];
  const lastCueEndsAt =
    cueLayers.length > 0
      ? Math.max(...cueLayers.map((layer) => layer.starts_at_seconds + layer.duration_seconds))
      : startAt + spacing;
  const duration = Math.max(fallback?.duration_seconds ?? 0, lastCueEndsAt + spacing, 1);

  return {
    id: packet.sleep.audio_plan_id,
    user_id: packet.user_id,
    duration_seconds: duration,
    layers: [
      {
        id: `${packet.sleep.audio_plan_id}:bed`,
        kind: "ambience",
        starts_at_seconds: 0,
        duration_seconds: duration,
        volume: Math.min(packet.sleep.max_volume * 0.3, 0.18),
        label: "sleep-safe ambience bed"
      },
      ...cueLayers,
      ...fallbackLayers
        .filter((layer) => layer.kind === "silence" || layer.kind === "fade")
        .map((layer, index) => ({
          ...layer,
          id: `${packet.sleep.audio_plan_id}:fallback:${index}:${layer.id}`,
          starts_at_seconds: Math.min(
            layer.starts_at_seconds,
            duration - Math.min(layer.duration_seconds, duration)
          ),
          duration_seconds: Math.min(layer.duration_seconds, duration)
        }))
    ],
    rendered_asset_id: fallback?.rendered_asset_id,
    render_status: fallback?.render_status === "ready" ? "ready" : "pending",
    created_at: packet.created_at
  };
}

function labelFromConceptId(conceptId: string): string {
  return conceptId.replaceAll("_", " ");
}
