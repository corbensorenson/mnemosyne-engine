import type { AudioPlan } from "@mnemosyne/schema";
import type { WorkerHandlerDefinition, WorkerJobContext, WorkerJobResult } from "@mnemosyne/worker-core";

export const RENDER_SLEEP_AUDIO_JOB_TYPE = "render_sleep_audio";

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

export function createAudioRendererWorkerHandlers(
  outputFormat: RenderManifest["output_format"] = "m4a"
): WorkerHandlerDefinition[] {
  return [
    {
      queue: "audio_render",
      type: RENDER_SLEEP_AUDIO_JOB_TYPE,
      handle: (context) => runAudioRenderWorkerJob(context, outputFormat)
    }
  ];
}

export async function runAudioRenderWorkerJob(
  context: WorkerJobContext,
  outputFormat: RenderManifest["output_format"] = "m4a"
): Promise<WorkerJobResult> {
  const audioPlanId = requiredPayloadString(context.job.payload, "audioPlanId", "audio_plan_id");
  const plan = await context.store.getAudioPlan(audioPlanId);
  if (!plan) throw new Error(`Cannot render unknown audio plan: ${audioPlanId}`);

  await context.store.saveAudioPlan({ ...plan, render_status: "rendering" });
  try {
    const manifest = buildRenderManifest(plan, outputFormat);
    const storedManifestId = context.objectStorage
      ? await storeRenderManifestObject(context, plan, manifest)
      : undefined;
    const renderedAssetId = storedManifestId ?? plan.rendered_asset_id;
    await context.store.saveAudioPlan({
      ...plan,
      rendered_asset_id: renderedAssetId,
      render_status: "ready"
    });

    return {
      audio_plan_id: plan.id,
      duration_seconds: manifest.duration_seconds,
      chapter_count: manifest.chapters.length,
      output_format: manifest.output_format,
      object_manifest_id: storedManifestId
    };
  } catch (error) {
    await context.store.saveAudioPlan({ ...plan, render_status: "failed" });
    throw error;
  }
}

async function storeRenderManifestObject(
  context: WorkerJobContext,
  plan: AudioPlan,
  manifest: RenderManifest
): Promise<string | undefined> {
  if (!context.objectStorage) return undefined;
  const stored = await context.objectStorage.putObject({
    bucket: "generated_asset",
    key: `audio-renders/${plan.user_id}/${plan.id}.${manifest.output_format}.render-manifest.json`,
    contentType: "application/vnd.mnemosyne.audio-render-manifest+json",
    body: JSON.stringify(manifest, null, 2),
    ownerId: plan.user_id,
    retentionPolicy: "user_controlled",
    metadata: {
      kind: "audio_render_manifest",
      audio_plan_id: plan.id,
      job_id: context.job.id,
      output_format: manifest.output_format
    }
  });
  const saved = await context.store.saveObjectManifest(stored.manifest);
  return saved.id;
}

function requiredPayloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  const value = keys.map((key) => payload[key]).find((entry) => typeof entry === "string" && entry);
  if (typeof value === "string") return value;
  throw new Error(`Missing required job payload field: ${keys.join(" or ")}`);
}
