import { createId, nowIso, round, stableHash } from "@mnemosyne/shared-utils";

export const queueNames = [
  "scheduler",
  "ingestion",
  "ai",
  "audio_render",
  "notification",
  "analytics",
  "export",
  "moderation"
] as const;
export type QueueName = (typeof queueNames)[number];

export const jobPriorities = ["low", "normal", "high", "critical"] as const;
export type JobPriority = (typeof jobPriorities)[number];

export const jobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "dead_lettered",
  "cancelled"
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export type JobRecord = {
  id: string;
  queue: QueueName;
  type: string;
  status: JobStatus;
  priority: JobPriority;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  run_after: string;
  locked_at?: string;
  locked_by?: string;
  result?: Record<string, unknown>;
  last_error?: string;
  cancellation_reason?: string;
  audit_subject_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

export const objectBuckets = [
  "audio",
  "transcript",
  "import",
  "generated_asset",
  "export",
  "evidence",
  "backup"
] as const;
export type ObjectBucket = (typeof objectBuckets)[number];

export const objectRetentionPolicies = [
  "temporary",
  "user_controlled",
  "product",
  "legal_hold",
  "backup"
] as const;
export type ObjectRetentionPolicy = (typeof objectRetentionPolicies)[number];

export type ObjectManifest = {
  id: string;
  bucket: ObjectBucket;
  key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  owner_id?: string;
  retention_policy: ObjectRetentionPolicy;
  encryption: {
    mode: "managed" | "customer_managed" | "external";
    status: "encrypted" | "pending";
    key_ref?: string;
  };
  metadata: Record<string, unknown>;
  created_at: string;
};

export type QueueSummary = {
  queue: QueueName;
  depth: number;
  runnable: number;
  delayed: number;
  running: number;
  completed: number;
  failed: number;
  dead_lettered: number;
  cancelled: number;
  critical_depth: number;
  oldest_queued_at?: string;
  stale_job_ids: string[];
};

export type ObjectStorageSummary = {
  bucket: ObjectBucket;
  object_count: number;
  total_bytes: number;
  encrypted_count: number;
  integrity_tracked_count: number;
};

export type OpsHealthDashboard = {
  generated_at: string;
  queues: QueueSummary[];
  objects: ObjectStorageSummary[];
  totals: {
    jobs: number;
    queued: number;
    running: number;
    failed: number;
    dead_lettered: number;
    objects: number;
    object_bytes: number;
  };
  failing_queues: QueueName[];
  stale_job_ids: string[];
  dead_letter_job_ids: string[];
  release_gates: {
    queues_configured: boolean;
    no_dead_letters: boolean;
    no_stale_running_jobs: boolean;
    objects_encrypted: boolean;
    object_integrity_tracked: boolean;
    idempotency_keys_present: boolean;
  };
  ready_for_release: boolean;
};

export function createJob(input: {
  queue: QueueName;
  type: string;
  payload?: Record<string, unknown>;
  priority?: JobPriority;
  maxAttempts?: number;
  idempotencyKey?: string;
  runAfter?: string;
  auditSubjectId?: string;
  createdAt?: string;
}): JobRecord {
  const createdAt = input.createdAt ?? nowIso();
  const payload = input.payload ?? {};
  const idempotencyKey =
    input.idempotencyKey ??
    `${input.queue}:${input.type}:${stableHash(stableJson(payload)).toString(36)}:${createdAt}`;
  return {
    id: createId("job", `${input.queue}:${idempotencyKey}`),
    queue: input.queue,
    type: input.type,
    status: "queued",
    priority: input.priority ?? "normal",
    payload,
    attempts: 0,
    max_attempts: input.maxAttempts ?? 3,
    idempotency_key: idempotencyKey,
    run_after: input.runAfter ?? createdAt,
    audit_subject_id: input.auditSubjectId,
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function isJobRunnable(job: JobRecord, at = nowIso()): boolean {
  return (
    (job.status === "queued" || job.status === "failed") &&
    job.attempts < job.max_attempts &&
    Date.parse(job.run_after) <= Date.parse(at)
  );
}

export function startJob(job: JobRecord, workerId: string, at = nowIso()): JobRecord {
  if (!isJobRunnable(job, at)) throw new Error(`Job is not runnable: ${job.id}`);
  return {
    ...job,
    status: "running",
    attempts: job.attempts + 1,
    locked_at: at,
    locked_by: workerId,
    last_error: undefined,
    updated_at: at
  };
}

export function completeJob(job: JobRecord, result: Record<string, unknown> = {}, at = nowIso()): JobRecord {
  if (job.status !== "running") throw new Error(`Job is not running: ${job.id}`);
  return {
    ...job,
    status: "completed",
    locked_at: undefined,
    locked_by: undefined,
    result,
    completed_at: at,
    updated_at: at
  };
}

export function failJob(job: JobRecord, error: string, at = nowIso()): JobRecord {
  const exhausted = job.attempts >= job.max_attempts;
  return {
    ...job,
    status: exhausted ? "dead_lettered" : "failed",
    locked_at: undefined,
    locked_by: undefined,
    last_error: error,
    updated_at: at
  };
}

export function cancelJob(job: JobRecord, reason: string, at = nowIso()): JobRecord {
  if (job.status === "completed") throw new Error(`Completed job cannot be cancelled: ${job.id}`);
  return {
    ...job,
    status: "cancelled",
    locked_at: undefined,
    locked_by: undefined,
    cancellation_reason: reason,
    updated_at: at
  };
}

export function createObjectManifest(input: {
  bucket: ObjectBucket;
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  ownerId?: string;
  retentionPolicy?: ObjectRetentionPolicy;
  metadata?: Record<string, unknown>;
  encryption?: ObjectManifest["encryption"];
  createdAt?: string;
}): ObjectManifest {
  const createdAt = input.createdAt ?? nowIso();
  return {
    id: createId("object", `${input.ownerId ?? "system"}:${input.bucket}:${input.key}:${input.sha256}`),
    bucket: input.bucket,
    key: input.key,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    sha256: input.sha256,
    owner_id: input.ownerId,
    retention_policy: input.retentionPolicy ?? "user_controlled",
    encryption: input.encryption ?? { mode: "managed", status: "encrypted" },
    metadata: input.metadata ?? {},
    created_at: createdAt
  };
}

export function queueDashboard(jobs: JobRecord[], at = nowIso(), staleAfterMinutes = 30): QueueSummary[] {
  return queueNames.map((queue) => {
    const queueJobs = jobs.filter((job) => job.queue === queue);
    const queuedJobs = queueJobs.filter((job) => job.status === "queued" || job.status === "failed");
    const staleCutoff = Date.parse(at) - staleAfterMinutes * 60_000;
    const staleJobIds = queueJobs
      .filter((job) => job.status === "running" && Date.parse(job.locked_at ?? job.updated_at) < staleCutoff)
      .map((job) => job.id);
    return {
      queue,
      depth: queuedJobs.length,
      runnable: queuedJobs.filter((job) => isJobRunnable(job, at)).length,
      delayed: queuedJobs.filter((job) => !isJobRunnable(job, at)).length,
      running: countStatus(queueJobs, "running"),
      completed: countStatus(queueJobs, "completed"),
      failed: countStatus(queueJobs, "failed"),
      dead_lettered: countStatus(queueJobs, "dead_lettered"),
      cancelled: countStatus(queueJobs, "cancelled"),
      critical_depth: queuedJobs.filter((job) => job.priority === "critical").length,
      oldest_queued_at: oldestIso(queuedJobs.map((job) => job.created_at)),
      stale_job_ids: staleJobIds
    };
  });
}

export function objectStorageDashboard(objects: ObjectManifest[]): ObjectStorageSummary[] {
  return objectBuckets.map((bucket) => {
    const bucketObjects = objects.filter((object) => object.bucket === bucket);
    return {
      bucket,
      object_count: bucketObjects.length,
      total_bytes: bucketObjects.reduce((sum, object) => sum + object.size_bytes, 0),
      encrypted_count: bucketObjects.filter((object) => object.encryption.status === "encrypted").length,
      integrity_tracked_count: bucketObjects.filter((object) => isLikelySha256(object.sha256)).length
    };
  });
}

export function buildOpsHealthDashboard(input: {
  jobs: JobRecord[];
  objects: ObjectManifest[];
  generatedAt?: string;
  staleAfterMinutes?: number;
}): OpsHealthDashboard {
  const generatedAt = input.generatedAt ?? nowIso();
  const queues = queueDashboard(input.jobs, generatedAt, input.staleAfterMinutes);
  const objects = objectStorageDashboard(input.objects);
  const staleJobIds = queues.flatMap((queue) => queue.stale_job_ids);
  const deadLetterJobIds = input.jobs.filter((job) => job.status === "dead_lettered").map((job) => job.id);
  const releaseGates = {
    queues_configured: queues.length === queueNames.length,
    no_dead_letters: deadLetterJobIds.length === 0,
    no_stale_running_jobs: staleJobIds.length === 0,
    objects_encrypted: input.objects.every((object) => object.encryption.status === "encrypted"),
    object_integrity_tracked: input.objects.every((object) => isLikelySha256(object.sha256)),
    idempotency_keys_present: input.jobs.every((job) => job.idempotency_key.length > 0)
  };
  return {
    generated_at: generatedAt,
    queues,
    objects,
    totals: {
      jobs: input.jobs.length,
      queued: input.jobs.filter((job) => job.status === "queued").length,
      running: input.jobs.filter((job) => job.status === "running").length,
      failed: input.jobs.filter((job) => job.status === "failed").length,
      dead_lettered: deadLetterJobIds.length,
      objects: input.objects.length,
      object_bytes: round(
        input.objects.reduce((sum, object) => sum + object.size_bytes, 0),
        0
      )
    },
    failing_queues: queues
      .filter((queue) => queue.dead_lettered > 0 || queue.stale_job_ids.length > 0)
      .map((queue) => queue.queue),
    stale_job_ids: staleJobIds,
    dead_letter_job_ids: deadLetterJobIds,
    release_gates: releaseGates,
    ready_for_release: Object.values(releaseGates).every(Boolean)
  };
}

function countStatus(jobs: JobRecord[], status: JobStatus): number {
  return jobs.filter((job) => job.status === status).length;
}

function oldestIso(values: string[]): string | undefined {
  return values.sort((left, right) => left.localeCompare(right))[0];
}

function isLikelySha256(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
