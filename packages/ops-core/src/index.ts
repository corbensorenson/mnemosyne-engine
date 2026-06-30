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

export type MonitoringAlertSeverity = "info" | "warning" | "critical";
export type MonitoringAlertCategory = "dependency" | "queue" | "object_storage" | "release_gate" | "security";

export type MonitoringAlert = {
  id: string;
  severity: MonitoringAlertSeverity;
  category: MonitoringAlertCategory;
  title: string;
  message: string;
  source: string;
  queue?: QueueName;
  details?: Record<string, unknown>;
};

export type MonitoringDependencyComponent = {
  status: "ok" | "error";
  checked_at?: string;
  message?: string;
};

export type MonitoringDependencyReadiness = {
  service: string;
  status: "ready" | "not_ready";
  environment?: string;
  checked_at?: string;
  components: Record<string, MonitoringDependencyComponent>;
};

export type MonitoringSecurityGate = {
  passed: boolean;
  csp_present?: boolean;
  csrf_required_for_mutation?: boolean;
  rate_limits_present?: boolean;
  high_stakes_labeled?: boolean;
  expert_review_required_when_high_stakes?: boolean;
  audit_safe?: boolean;
};

export type MonitoringServiceLevel = {
  service: string;
  status: "healthy" | "degraded" | "critical";
  summary: string;
  checked_at?: string;
};

export type MonitoringThresholds = {
  queueDepthWarning: number;
  queueDepthCritical: number;
  runnableWarning: number;
  runnableCritical: number;
  criticalDepthWarning: number;
  criticalDepthCritical: number;
  failedJobsWarning: number;
};

export type OpsMonitoringDashboard = {
  generated_at: string;
  status: "nominal" | "degraded" | "critical";
  ready_for_release: boolean;
  alert_counts: Record<MonitoringAlertSeverity | "total", number>;
  alerts: MonitoringAlert[];
  service_levels: MonitoringServiceLevel[];
  release_gates: {
    ops: boolean;
    security?: boolean;
    dependencies?: boolean;
  };
  ops_health: OpsHealthDashboard;
};

export const defaultMonitoringThresholds: MonitoringThresholds = {
  queueDepthWarning: 50,
  queueDepthCritical: 250,
  runnableWarning: 25,
  runnableCritical: 100,
  criticalDepthWarning: 1,
  criticalDepthCritical: 10,
  failedJobsWarning: 1
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

export function buildOpsMonitoringDashboard(input: {
  opsHealth: OpsHealthDashboard;
  securityGate?: MonitoringSecurityGate;
  dependencyReadiness?: MonitoringDependencyReadiness;
  generatedAt?: string;
  thresholds?: Partial<MonitoringThresholds>;
}): OpsMonitoringDashboard {
  const generatedAt = input.generatedAt ?? input.opsHealth.generated_at ?? nowIso();
  const thresholds = { ...defaultMonitoringThresholds, ...(input.thresholds ?? {}) };
  const alerts = sortAlerts([
    ...releaseGateAlerts(input.opsHealth),
    ...queueAlerts(input.opsHealth, thresholds),
    ...objectStorageAlerts(input.opsHealth),
    ...dependencyAlerts(input.dependencyReadiness),
    ...securityAlerts(input.securityGate)
  ]);
  const alertCounts = countAlerts(alerts);
  const dependenciesReady = input.dependencyReadiness
    ? input.dependencyReadiness.status === "ready"
    : undefined;
  const securityReady = input.securityGate ? input.securityGate.passed : undefined;
  const status = alertCounts.critical > 0 ? "critical" : alertCounts.warning > 0 ? "degraded" : "nominal";
  return {
    generated_at: generatedAt,
    status,
    ready_for_release:
      input.opsHealth.ready_for_release &&
      securityReady !== false &&
      dependenciesReady !== false &&
      alertCounts.critical === 0,
    alert_counts: alertCounts,
    alerts,
    service_levels: buildServiceLevels({
      opsHealth: input.opsHealth,
      alerts,
      securityGate: input.securityGate,
      dependencyReadiness: input.dependencyReadiness
    }),
    release_gates: {
      ops: input.opsHealth.ready_for_release,
      security: securityReady,
      dependencies: dependenciesReady
    },
    ops_health: input.opsHealth
  };
}

function countStatus(jobs: JobRecord[], status: JobStatus): number {
  return jobs.filter((job) => job.status === status).length;
}

function releaseGateAlerts(health: OpsHealthDashboard): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  if (!health.release_gates.queues_configured) {
    alerts.push(
      alert(
        "ops.release.queues_configured",
        "critical",
        "release_gate",
        "Queues are not fully configured",
        "The configured queue set does not match the first-party queue contract.",
        "ops-core"
      )
    );
  }
  if (!health.release_gates.no_dead_letters) {
    alerts.push(
      alert(
        "ops.release.dead_letters",
        "critical",
        "release_gate",
        "Dead-lettered jobs require action",
        `${health.dead_letter_job_ids.length} job(s) are dead-lettered and must be inspected before promotion.`,
        "ops-core",
        { dead_letter_job_ids: health.dead_letter_job_ids }
      )
    );
  }
  if (!health.release_gates.no_stale_running_jobs) {
    alerts.push(
      alert(
        "ops.release.stale_running_jobs",
        "critical",
        "release_gate",
        "Stale running jobs require recovery",
        `${health.stale_job_ids.length} running job(s) exceeded the stale-lock threshold.`,
        "ops-core",
        { stale_job_ids: health.stale_job_ids }
      )
    );
  }
  if (!health.release_gates.objects_encrypted) {
    alerts.push(
      alert(
        "ops.release.objects_encrypted",
        "critical",
        "object_storage",
        "Object encryption gate failed",
        "At least one stored object manifest is not marked encrypted.",
        "ops-core"
      )
    );
  }
  if (!health.release_gates.object_integrity_tracked) {
    alerts.push(
      alert(
        "ops.release.object_integrity",
        "critical",
        "object_storage",
        "Object integrity gate failed",
        "At least one stored object manifest is missing a valid SHA-256 digest.",
        "ops-core"
      )
    );
  }
  if (!health.release_gates.idempotency_keys_present) {
    alerts.push(
      alert(
        "ops.release.idempotency",
        "critical",
        "release_gate",
        "Job idempotency gate failed",
        "At least one job is missing an idempotency key.",
        "ops-core"
      )
    );
  }
  return alerts;
}

function queueAlerts(health: OpsHealthDashboard, thresholds: MonitoringThresholds): MonitoringAlert[] {
  return health.queues.flatMap((queue) => {
    const alerts: MonitoringAlert[] = [];
    addThresholdAlert(alerts, {
      id: `ops.queue.${queue.queue}.depth`,
      queue: queue.queue,
      value: queue.depth,
      warning: thresholds.queueDepthWarning,
      critical: thresholds.queueDepthCritical,
      title: `${queue.queue} queue depth is elevated`,
      message: `${queue.depth} queued or retryable job(s) are waiting in ${queue.queue}.`
    });
    addThresholdAlert(alerts, {
      id: `ops.queue.${queue.queue}.runnable`,
      queue: queue.queue,
      value: queue.runnable,
      warning: thresholds.runnableWarning,
      critical: thresholds.runnableCritical,
      title: `${queue.queue} runnable backlog is elevated`,
      message: `${queue.runnable} runnable job(s) can be claimed now in ${queue.queue}.`
    });
    addThresholdAlert(alerts, {
      id: `ops.queue.${queue.queue}.critical_depth`,
      queue: queue.queue,
      value: queue.critical_depth,
      warning: thresholds.criticalDepthWarning,
      critical: thresholds.criticalDepthCritical,
      title: `${queue.queue} has critical-priority work queued`,
      message: `${queue.critical_depth} critical-priority job(s) are waiting in ${queue.queue}.`
    });
    if (queue.failed >= thresholds.failedJobsWarning) {
      alerts.push(
        alert(
          `ops.queue.${queue.queue}.failed`,
          "warning",
          "queue",
          `${queue.queue} has retryable failures`,
          `${queue.failed} failed job(s) are waiting for retry in ${queue.queue}.`,
          "ops-core",
          { failed: queue.failed },
          queue.queue
        )
      );
    }
    return alerts;
  });
}

function objectStorageAlerts(health: OpsHealthDashboard): MonitoringAlert[] {
  return health.objects.flatMap((bucket) => {
    const alerts: MonitoringAlert[] = [];
    if (bucket.encrypted_count < bucket.object_count) {
      alerts.push(
        alert(
          `ops.object.${bucket.bucket}.encryption`,
          "critical",
          "object_storage",
          `${bucket.bucket} contains unencrypted objects`,
          `${bucket.object_count - bucket.encrypted_count} object(s) in ${bucket.bucket} are not marked encrypted.`,
          "ops-core",
          {
            bucket: bucket.bucket,
            object_count: bucket.object_count,
            encrypted_count: bucket.encrypted_count
          }
        )
      );
    }
    if (bucket.integrity_tracked_count < bucket.object_count) {
      alerts.push(
        alert(
          `ops.object.${bucket.bucket}.integrity`,
          "critical",
          "object_storage",
          `${bucket.bucket} contains objects without SHA-256 integrity`,
          `${bucket.object_count - bucket.integrity_tracked_count} object(s) in ${bucket.bucket} are missing valid SHA-256 integrity.`,
          "ops-core",
          {
            bucket: bucket.bucket,
            object_count: bucket.object_count,
            integrity_tracked_count: bucket.integrity_tracked_count
          }
        )
      );
    }
    return alerts;
  });
}

function dependencyAlerts(readiness?: MonitoringDependencyReadiness): MonitoringAlert[] {
  if (!readiness) return [];
  const alerts: MonitoringAlert[] = [];
  if (readiness.status !== "ready") {
    alerts.push(
      alert(
        "ops.dependency.readiness",
        "critical",
        "dependency",
        "API dependencies are not ready",
        `${readiness.service} reported ${readiness.status}.`,
        readiness.service,
        { environment: readiness.environment }
      )
    );
  }
  for (const [name, component] of Object.entries(readiness.components)) {
    if (component.status === "error") {
      alerts.push(
        alert(
          `ops.dependency.${name}`,
          "critical",
          "dependency",
          `${name} dependency check failed`,
          component.message ?? `${name} returned an error readiness status.`,
          readiness.service,
          { component: name, checked_at: component.checked_at }
        )
      );
    }
  }
  return alerts;
}

function securityAlerts(gate?: MonitoringSecurityGate): MonitoringAlert[] {
  if (!gate || gate.passed) return [];
  const failingChecks = [
    ["csp_present", gate.csp_present],
    ["csrf_required_for_mutation", gate.csrf_required_for_mutation],
    ["rate_limits_present", gate.rate_limits_present],
    ["high_stakes_labeled", gate.high_stakes_labeled],
    ["expert_review_required_when_high_stakes", gate.expert_review_required_when_high_stakes],
    ["audit_safe", gate.audit_safe]
  ]
    .filter(([, passed]) => passed === false)
    .map(([name]) => name);
  return [
    alert(
      "ops.security.release_gate",
      "critical",
      "security",
      "Security release gate failed",
      failingChecks.length
        ? `Security checks failed: ${failingChecks.join(", ")}.`
        : "The security release gate did not pass.",
      "security-core",
      { failing_checks: failingChecks }
    )
  ];
}

function addThresholdAlert(
  alerts: MonitoringAlert[],
  input: {
    id: string;
    queue: QueueName;
    value: number;
    warning: number;
    critical: number;
    title: string;
    message: string;
  }
): void {
  if (input.value >= input.critical) {
    alerts.push(
      alert(
        input.id,
        "critical",
        "queue",
        input.title,
        input.message,
        "ops-core",
        { value: input.value },
        input.queue
      )
    );
  } else if (input.value >= input.warning) {
    alerts.push(
      alert(
        input.id,
        "warning",
        "queue",
        input.title,
        input.message,
        "ops-core",
        { value: input.value },
        input.queue
      )
    );
  }
}

function buildServiceLevels(input: {
  opsHealth: OpsHealthDashboard;
  alerts: MonitoringAlert[];
  securityGate?: MonitoringSecurityGate;
  dependencyReadiness?: MonitoringDependencyReadiness;
}): MonitoringServiceLevel[] {
  const queueReleaseAlertIds = new Set([
    "ops.release.queues_configured",
    "ops.release.dead_letters",
    "ops.release.stale_running_jobs",
    "ops.release.idempotency"
  ]);
  const queueAlertsForLevel = input.alerts.filter(
    (alertEntry) => alertEntry.category === "queue" || queueReleaseAlertIds.has(alertEntry.id)
  );
  const objectAlertsForLevel = input.alerts.filter((alertEntry) => alertEntry.category === "object_storage");
  const levels: MonitoringServiceLevel[] = [
    {
      service: "ops_queues",
      status: levelFromAlerts(queueAlertsForLevel),
      summary: `${input.opsHealth.totals.queued} queued, ${input.opsHealth.totals.running} running, ${input.opsHealth.totals.dead_lettered} dead-lettered.`
    },
    {
      service: "object_storage",
      status: levelFromAlerts(objectAlertsForLevel),
      summary: `${input.opsHealth.totals.objects} objects, ${input.opsHealth.totals.object_bytes} bytes tracked.`
    }
  ];
  if (input.securityGate) {
    levels.push({
      service: "security",
      status: input.securityGate.passed ? "healthy" : "critical",
      summary: input.securityGate.passed ? "Security release gate passed." : "Security release gate failed."
    });
  }
  if (input.dependencyReadiness) {
    levels.push({
      service: "api_dependencies",
      status: input.dependencyReadiness.status === "ready" ? "healthy" : "critical",
      summary: `${input.dependencyReadiness.service} is ${input.dependencyReadiness.status}.`,
      checked_at: input.dependencyReadiness.checked_at
    });
  }
  return levels;
}

function levelFromAlerts(alerts: MonitoringAlert[]): MonitoringServiceLevel["status"] {
  if (alerts.some((alertEntry) => alertEntry.severity === "critical")) return "critical";
  if (alerts.some((alertEntry) => alertEntry.severity === "warning")) return "degraded";
  return "healthy";
}

function countAlerts(alerts: MonitoringAlert[]): Record<MonitoringAlertSeverity | "total", number> {
  return {
    total: alerts.length,
    critical: alerts.filter((alertEntry) => alertEntry.severity === "critical").length,
    warning: alerts.filter((alertEntry) => alertEntry.severity === "warning").length,
    info: alerts.filter((alertEntry) => alertEntry.severity === "info").length
  };
}

function sortAlerts(alerts: MonitoringAlert[]): MonitoringAlert[] {
  const severityOrder: Record<MonitoringAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((left, right) => {
    const severity = severityOrder[left.severity] - severityOrder[right.severity];
    if (severity !== 0) return severity;
    return left.id.localeCompare(right.id);
  });
}

function alert(
  id: string,
  severity: MonitoringAlertSeverity,
  category: MonitoringAlertCategory,
  title: string,
  message: string,
  source: string,
  details?: Record<string, unknown>,
  queue?: QueueName
): MonitoringAlert {
  return {
    id,
    severity,
    category,
    title,
    message,
    source,
    details,
    queue
  };
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
