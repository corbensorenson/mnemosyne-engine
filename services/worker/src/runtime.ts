import { createAudioRendererWorkerHandlers, type RenderManifest } from "@mnemosyne/audio-renderer-service";
import { configFromEnv, createConfiguredStore, seedDemoStore, type ApiRuntimeConfig } from "@mnemosyne/api";
import { queueNames, type QueueName } from "@mnemosyne/ops-core";
import { createSchedulerWorkerHandlers } from "@mnemosyne/scheduler-service";
import { createLocalObjectStorage } from "@mnemosyne/storage-core";
import {
  createWorkerHandlerRegistry,
  recoverStaleWorkerLocks,
  runWorkerBatch,
  runWorkerLoop,
  runWorkerOnce,
  type WorkerBatchResult,
  type WorkerHandlerDefinition,
  type WorkerHandlerRegistry,
  type WorkerRecoveryResult,
  type WorkerRunResult
} from "@mnemosyne/worker-core";

export type WorkerServiceMode = "once" | "batch" | "loop" | "recover";

export type WorkerServiceConfig = ApiRuntimeConfig & {
  workerId: string;
  mode: WorkerServiceMode;
  queues?: QueueName[];
  maxJobs: number;
  pollIntervalMs: number;
  maxIterations?: number;
  staleAfterMinutes: number;
  recoveryLimit: number;
  audioOutputFormat: RenderManifest["output_format"];
};

export type WorkerServiceRuntime = {
  config: WorkerServiceConfig;
  store: Awaited<ReturnType<typeof createConfiguredStore>>["store"];
  objectStorage: ReturnType<typeof createLocalObjectStorage>;
  handlers: WorkerHandlerRegistry;
  close: () => Promise<void>;
};

export type WorkerServiceRunResult =
  WorkerRunResult | WorkerBatchResult | WorkerRunResult[] | WorkerRecoveryResult;

export function workerServiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerServiceConfig {
  return {
    ...configFromEnv(env),
    workerId: env.MNEMOSYNE_WORKER_ID ?? `worker-${process.pid}`,
    mode: parseWorkerMode(env.MNEMOSYNE_WORKER_MODE),
    queues: parseQueues(env.MNEMOSYNE_WORKER_QUEUES),
    maxJobs: parsePositiveInteger(env.MNEMOSYNE_WORKER_MAX_JOBS, 10),
    pollIntervalMs: parsePositiveInteger(env.MNEMOSYNE_WORKER_POLL_MS, 1_000),
    maxIterations: parseOptionalPositiveInteger(env.MNEMOSYNE_WORKER_MAX_ITERATIONS),
    staleAfterMinutes: parsePositiveInteger(env.MNEMOSYNE_WORKER_STALE_AFTER_MINUTES, 30),
    recoveryLimit: parsePositiveInteger(env.MNEMOSYNE_WORKER_RECOVERY_LIMIT, 25),
    audioOutputFormat: parseAudioOutputFormat(env.MNEMOSYNE_AUDIO_OUTPUT_FORMAT)
  };
}

export async function createWorkerServiceRuntime(
  config: WorkerServiceConfig = workerServiceConfigFromEnv()
): Promise<WorkerServiceRuntime> {
  const { store, close } = await createConfiguredStore(config);
  const objectStorage = createLocalObjectStorage(config.objectStorageRoot);
  if (config.seedDemo) await seedDemoStore(store);
  const handlers = createWorkerHandlerRegistry([
    ...createSchedulerWorkerHandlers(),
    ...createAudioRendererWorkerHandlers(config.audioOutputFormat),
    ...createPrivacyExportWorkerHandlers()
  ]);
  return {
    config,
    store,
    objectStorage,
    handlers,
    close
  };
}

export async function runWorkerServiceOnce(runtime: WorkerServiceRuntime): Promise<WorkerRunResult> {
  return runWorkerOnce({
    store: runtime.store,
    workerId: runtime.config.workerId,
    handlers: runtime.handlers,
    queues: runtime.config.queues,
    objectStorage: runtime.objectStorage
  });
}

export async function runWorkerServiceBatch(runtime: WorkerServiceRuntime): Promise<WorkerBatchResult> {
  return runWorkerBatch({
    store: runtime.store,
    workerId: runtime.config.workerId,
    handlers: runtime.handlers,
    queues: runtime.config.queues,
    objectStorage: runtime.objectStorage,
    maxJobs: runtime.config.maxJobs
  });
}

export async function runWorkerServiceLoop(
  runtime: WorkerServiceRuntime,
  shouldStop?: () => boolean | Promise<boolean>
): Promise<WorkerRunResult[]> {
  return runWorkerLoop({
    store: runtime.store,
    workerId: runtime.config.workerId,
    handlers: runtime.handlers,
    queues: runtime.config.queues,
    objectStorage: runtime.objectStorage,
    pollIntervalMs: runtime.config.pollIntervalMs,
    maxIterations: runtime.config.maxIterations,
    shouldStop
  });
}

export async function runWorkerServiceRecovery(runtime: WorkerServiceRuntime): Promise<WorkerRecoveryResult> {
  return recoverStaleWorkerLocks({
    store: runtime.store,
    workerId: runtime.config.workerId,
    queues: runtime.config.queues,
    staleAfterMinutes: runtime.config.staleAfterMinutes,
    limit: runtime.config.recoveryLimit
  });
}

export async function runWorkerService(runtime: WorkerServiceRuntime): Promise<WorkerServiceRunResult> {
  if (runtime.config.mode === "once") return runWorkerServiceOnce(runtime);
  if (runtime.config.mode === "batch") return runWorkerServiceBatch(runtime);
  if (runtime.config.mode === "recover") return runWorkerServiceRecovery(runtime);
  return runWorkerServiceLoop(runtime);
}

export async function runWorkerServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ runtime: WorkerServiceRuntime; result: WorkerServiceRunResult }> {
  const runtime = await createWorkerServiceRuntime(workerServiceConfigFromEnv(env));
  try {
    const result = await runWorkerService(runtime);
    return { runtime, result };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

export function createPrivacyExportWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "export",
      type: "build_privacy_export",
      async handle(context) {
        if (!context.objectStorage) throw new Error("privacy export worker requires object storage");
        const userId = payloadString(context.job.payload, "user_id");
        const bundle = await context.store.exportUserData(userId);
        const body = JSON.stringify(bundle, null, 2);
        const stored = await context.objectStorage.putObject({
          bucket: "export",
          key: `exports/${safePathSegment(userId)}/${safePathSegment(context.job.id)}.json`,
          contentType: "application/json",
          body,
          ownerId: userId,
          retentionPolicy: "user_controlled",
          metadata: {
            job_id: context.job.id,
            schema_version: bundle.schema_version,
            requested_at:
              typeof context.job.payload.requested_at === "string"
                ? context.job.payload.requested_at
                : undefined
          }
        });
        const manifest = await context.store.saveObjectManifest(stored.manifest);
        const audit = await context.store.appendAuditEvent({
          actor_id: userId,
          action: "privacy_export_object_stored",
          object_type: "object_manifest",
          object_id: manifest.id,
          payload: {
            job_id: context.job.id,
            bucket: manifest.bucket,
            key: manifest.key,
            size_bytes: manifest.size_bytes,
            sha256: manifest.sha256,
            schema_version: bundle.schema_version
          }
        });
        return {
          user_id: userId,
          object_manifest_id: manifest.id,
          object_key: manifest.key,
          bytes_written: stored.bytes_written,
          sha256: stored.sha256,
          audit_event_id: audit.id,
          schema_version: bundle.schema_version
        };
      }
    }
  ];
}

function parseWorkerMode(value: string | undefined): WorkerServiceMode {
  if (value === "once" || value === "batch" || value === "loop" || value === "recover") return value;
  return "loop";
}

function parseQueues(value: string | undefined): QueueName[] | undefined {
  if (!value?.trim()) return undefined;
  const queues = value
    .split(",")
    .map((queue) => queue.trim())
    .filter(Boolean);
  for (const queue of queues) {
    if (!(queueNames as readonly string[]).includes(queue)) {
      throw new Error(`Unknown worker queue: ${queue}`);
    }
  }
  return queues as QueueName[];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAudioOutputFormat(value: string | undefined): RenderManifest["output_format"] {
  if (value === "m4a" || value === "mp3" || value === "wav") return value;
  return "m4a";
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`privacy export job payload requires ${key}`);
  }
  return value;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
