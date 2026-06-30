import {
  completeJob,
  failJob,
  isJobRunnable,
  jobPriorities,
  startJob,
  type JobRecord,
  type QueueName
} from "@mnemosyne/ops-core";
import type { MnemosyneStore } from "@mnemosyne/persistence-core";
import { nowIso } from "@mnemosyne/shared-utils";
import type { ObjectStorageAdapter } from "@mnemosyne/storage-core";

export type WorkerJobContext = {
  store: MnemosyneStore;
  job: JobRecord;
  workerId: string;
  objectStorage?: ObjectStorageAdapter;
  startedAt: string;
};

export type WorkerJobResult = Record<string, unknown>;
export type WorkerJobHandler = (context: WorkerJobContext) => Promise<WorkerJobResult | void>;

export type WorkerHandlerDefinition = {
  queue: QueueName;
  type: string;
  handle: WorkerJobHandler;
};

export type WorkerHandlerRegistry = ReadonlyMap<string, WorkerJobHandler>;

export type WorkerRunOptions = {
  store: MnemosyneStore;
  workerId: string;
  handlers: WorkerHandlerRegistry;
  queues?: QueueName[];
  objectStorage?: ObjectStorageAdapter;
  now?: string;
};

export type WorkerRunResult =
  | {
      status: "idle";
      worker_id: string;
      checked_at: string;
    }
  | {
      status: "completed";
      worker_id: string;
      job: JobRecord;
      result: WorkerJobResult;
      audit_event_ids: string[];
    }
  | {
      status: "failed" | "dead_lettered";
      worker_id: string;
      job: JobRecord;
      error: string;
      audit_event_ids: string[];
    };

export type WorkerBatchResult = {
  worker_id: string;
  results: WorkerRunResult[];
  completed: number;
  failed: number;
  dead_lettered: number;
};

export function createWorkerHandlerRegistry(definitions: WorkerHandlerDefinition[]): WorkerHandlerRegistry {
  return new Map(
    definitions.map((definition) => [workerHandlerKey(definition.queue, definition.type), definition.handle])
  );
}

export function workerHandlerKey(queue: QueueName, type: string): string {
  return `${queue}:${type}`;
}

export async function runWorkerOnce(options: WorkerRunOptions): Promise<WorkerRunResult> {
  const checkedAt = options.now ?? nowIso();
  const running = await claimNextRunnableJob(options, checkedAt);
  if (!running) {
    return {
      status: "idle",
      worker_id: options.workerId,
      checked_at: checkedAt
    };
  }

  const startedAuditId = await appendJobAudit(options.store, running, "job_started", options.workerId, {
    attempts: running.attempts
  });
  const handler = options.handlers.get(workerHandlerKey(running.queue, running.type));
  if (!handler) {
    const failed = await failRunningJob(
      options.store,
      running,
      `No worker handler registered for ${running.queue}:${running.type}`
    );
    const failedAuditId = await appendJobAudit(
      options.store,
      failed,
      terminalAuditAction(failed),
      options.workerId,
      {
        attempts: failed.attempts,
        error: failed.last_error
      }
    );
    return {
      status: failed.status === "dead_lettered" ? "dead_lettered" : "failed",
      worker_id: options.workerId,
      job: failed,
      error: failed.last_error ?? "Unknown worker error",
      audit_event_ids: [startedAuditId, failedAuditId].filter(isDefined)
    };
  }

  try {
    const result =
      (await handler({
        store: options.store,
        job: running,
        workerId: options.workerId,
        objectStorage: options.objectStorage,
        startedAt: running.locked_at ?? checkedAt
      })) ?? {};
    const completed = await options.store.saveJob(completeJob(running, result));
    const completedAuditId = await appendJobAudit(
      options.store,
      completed,
      "job_completed",
      options.workerId,
      {
        attempts: completed.attempts,
        result_keys: Object.keys(result)
      }
    );
    return {
      status: "completed",
      worker_id: options.workerId,
      job: completed,
      result,
      audit_event_ids: [startedAuditId, completedAuditId].filter(isDefined)
    };
  } catch (error) {
    const failed = await failRunningJob(options.store, running, errorMessage(error));
    const failedAuditId = await appendJobAudit(
      options.store,
      failed,
      terminalAuditAction(failed),
      options.workerId,
      {
        attempts: failed.attempts,
        error: failed.last_error
      }
    );
    return {
      status: failed.status === "dead_lettered" ? "dead_lettered" : "failed",
      worker_id: options.workerId,
      job: failed,
      error: failed.last_error ?? "Unknown worker error",
      audit_event_ids: [startedAuditId, failedAuditId].filter(isDefined)
    };
  }
}

export async function runWorkerBatch(
  options: WorkerRunOptions & { maxJobs?: number }
): Promise<WorkerBatchResult> {
  const maxJobs = options.maxJobs ?? 10;
  const results: WorkerRunResult[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const result = await runWorkerOnce(options);
    if (result.status === "idle") break;
    results.push(result);
  }
  return {
    worker_id: options.workerId,
    results,
    completed: results.filter((result) => result.status === "completed").length,
    failed: results.filter((result) => result.status === "failed").length,
    dead_lettered: results.filter((result) => result.status === "dead_lettered").length
  };
}

export async function runWorkerLoop(
  options: WorkerRunOptions & {
    pollIntervalMs?: number;
    maxIterations?: number;
    shouldStop?: () => boolean | Promise<boolean>;
  }
): Promise<WorkerRunResult[]> {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const results: WorkerRunResult[] = [];
  let iterations = 0;
  while (!(await options.shouldStop?.())) {
    const result = await runWorkerOnce(options);
    results.push(result);
    iterations += 1;
    if (options.maxIterations && iterations >= options.maxIterations) break;
    if (result.status === "idle") await sleep(pollIntervalMs);
  }
  return results;
}

export async function claimNextRunnableJob(
  options: Pick<WorkerRunOptions, "store" | "workerId" | "handlers" | "queues">,
  at = nowIso()
): Promise<JobRecord | undefined> {
  const jobs = await options.store.listJobs();
  const candidates = jobs
    .filter((job) => queueAllowed(job, options.queues))
    .filter((job) => options.handlers.has(workerHandlerKey(job.queue, job.type)))
    .filter((job) => isJobRunnable(job, at))
    .sort(compareRunnableJobs);
  const next = candidates[0];
  if (!next) return undefined;
  return options.store.saveJob(startJob(next, options.workerId, at));
}

async function failRunningJob(store: MnemosyneStore, job: JobRecord, message: string): Promise<JobRecord> {
  return store.saveJob(failJob(job, message));
}

async function appendJobAudit(
  store: MnemosyneStore,
  job: JobRecord,
  action: "job_started" | "job_completed" | "job_failed" | "job_dead_lettered",
  workerId: string,
  payload: Record<string, unknown>
): Promise<string | undefined> {
  const event = await store.appendAuditEvent({
    actor_id: job.audit_subject_id ?? workerId,
    action,
    object_type: "service_job",
    object_id: job.id,
    payload: {
      queue: job.queue,
      type: job.type,
      worker_id: workerId,
      status: job.status,
      ...payload
    }
  });
  return event.id;
}

function terminalAuditAction(job: JobRecord): "job_failed" | "job_dead_lettered" {
  return job.status === "dead_lettered" ? "job_dead_lettered" : "job_failed";
}

function queueAllowed(job: JobRecord, queues: QueueName[] | undefined): boolean {
  return !queues || queues.includes(job.queue);
}

function compareRunnableJobs(left: JobRecord, right: JobRecord): number {
  const priorityDelta = priorityRank(right.priority) - priorityRank(left.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const runAfterDelta = left.run_after.localeCompare(right.run_after);
  if (runAfterDelta !== 0) return runAfterDelta;
  return left.created_at.localeCompare(right.created_at);
}

function priorityRank(priority: JobRecord["priority"]): number {
  return jobPriorities.indexOf(priority);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
