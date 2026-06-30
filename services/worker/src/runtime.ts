import { createAudioRendererWorkerHandlers, type RenderManifest } from "@mnemosyne/audio-renderer-service";
import { configFromEnv, createConfiguredStore, seedDemoStore, type ApiRuntimeConfig } from "@mnemosyne/api";
import { queueNames, type QueueName } from "@mnemosyne/ops-core";
import { createSchedulerWorkerHandlers } from "@mnemosyne/scheduler-service";
import { createLocalObjectStorage } from "@mnemosyne/storage-core";
import {
  createWorkerHandlerRegistry,
  runWorkerBatch,
  runWorkerLoop,
  runWorkerOnce,
  type WorkerBatchResult,
  type WorkerHandlerRegistry,
  type WorkerRunResult
} from "@mnemosyne/worker-core";

export type WorkerServiceMode = "once" | "batch" | "loop";

export type WorkerServiceConfig = ApiRuntimeConfig & {
  workerId: string;
  mode: WorkerServiceMode;
  queues?: QueueName[];
  maxJobs: number;
  pollIntervalMs: number;
  maxIterations?: number;
  audioOutputFormat: RenderManifest["output_format"];
};

export type WorkerServiceRuntime = {
  config: WorkerServiceConfig;
  store: Awaited<ReturnType<typeof createConfiguredStore>>["store"];
  objectStorage: ReturnType<typeof createLocalObjectStorage>;
  handlers: WorkerHandlerRegistry;
  close: () => Promise<void>;
};

export type WorkerServiceRunResult = WorkerRunResult | WorkerBatchResult | WorkerRunResult[];

export function workerServiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerServiceConfig {
  return {
    ...configFromEnv(env),
    workerId: env.MNEMOSYNE_WORKER_ID ?? `worker-${process.pid}`,
    mode: parseWorkerMode(env.MNEMOSYNE_WORKER_MODE),
    queues: parseQueues(env.MNEMOSYNE_WORKER_QUEUES),
    maxJobs: parsePositiveInteger(env.MNEMOSYNE_WORKER_MAX_JOBS, 10),
    pollIntervalMs: parsePositiveInteger(env.MNEMOSYNE_WORKER_POLL_MS, 1_000),
    maxIterations: parseOptionalPositiveInteger(env.MNEMOSYNE_WORKER_MAX_ITERATIONS),
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
    ...createAudioRendererWorkerHandlers(config.audioOutputFormat)
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

export async function runWorkerService(runtime: WorkerServiceRuntime): Promise<WorkerServiceRunResult> {
  if (runtime.config.mode === "once") return runWorkerServiceOnce(runtime);
  if (runtime.config.mode === "batch") return runWorkerServiceBatch(runtime);
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

function parseWorkerMode(value: string | undefined): WorkerServiceMode {
  if (value === "once" || value === "batch" || value === "loop") return value;
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
