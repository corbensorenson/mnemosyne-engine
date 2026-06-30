import { createAudioRendererWorkerHandlers, type RenderManifest } from "@mnemosyne/audio-renderer-service";
import {
  configFromEnv,
  createApiHandlers,
  createConfiguredStore,
  seedDemoStore,
  type ApiRuntimeConfig
} from "@mnemosyne/api";
import {
  arbitrateProposal,
  statusForArbiterDecision,
  triageProposalForModeration,
  type ModerationTriage
} from "@mnemosyne/content-court";
import type { NotificationPlanItem } from "@mnemosyne/notification-core";
import { queueNames, type ObjectManifest, type QueueName } from "@mnemosyne/ops-core";
import { buildOutcomeDashboard } from "@mnemosyne/outcome-core";
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

type RestoreDrillCheck = {
  id: string;
  status: "pass" | "fail";
  detail: string;
  expected?: unknown;
  actual?: unknown;
};

type SystemBackupRestoreDrillReport = {
  schema_version: "mnemosyne-restore-drill-v0.1";
  generated_at: string;
  operator_id: string;
  object_manifest_id: string;
  object_key: string;
  backup_schema_version?: string;
  passed: boolean;
  checks: RestoreDrillCheck[];
  failed_check_ids: string[];
  counts: {
    users: number;
    jobs: number;
    object_manifests: number;
    audit_events: number;
    user_graph_states: number;
    daily_packets: number;
    sleep_cue_packets: number;
  };
  sampled_user_ids: string[];
};

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
    ...createNotificationWorkerHandlers(),
    ...createCreatorIngestionWorkerHandlers(),
    ...createLocalArbiterWorkerHandlers(),
    ...createOutcomeAnalyticsWorkerHandlers(),
    ...createPrivacyExportWorkerHandlers(),
    ...createSystemBackupWorkerHandlers(),
    ...createModerationWorkerHandlers()
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

export function createSystemBackupWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "export",
      type: "build_system_backup",
      async handle(context) {
        if (!context.objectStorage) throw new Error("system backup worker requires object storage");
        const operatorId = payloadString(context.job.payload, "operator_id");
        const bundle = await context.store.exportSystemData();
        const body = JSON.stringify(bundle, null, 2);
        const stored = await context.objectStorage.putObject({
          bucket: "backup",
          key: `backups/system/${safePathSegment(context.job.id)}.json`,
          contentType: "application/json",
          body,
          ownerId: operatorId,
          retentionPolicy: "backup",
          metadata: {
            job_id: context.job.id,
            schema_version: bundle.schema_version,
            users: bundle.counts.users,
            jobs: bundle.counts.jobs,
            object_manifests: bundle.counts.object_manifests,
            requested_at:
              typeof context.job.payload.requested_at === "string"
                ? context.job.payload.requested_at
                : undefined
          }
        });
        const manifest = await context.store.saveObjectManifest(stored.manifest);
        const audit = await context.store.appendAuditEvent({
          actor_id: operatorId,
          action: "system_backup_object_stored",
          object_type: "object_manifest",
          object_id: manifest.id,
          payload: {
            job_id: context.job.id,
            bucket: manifest.bucket,
            key: manifest.key,
            size_bytes: manifest.size_bytes,
            sha256: manifest.sha256,
            schema_version: bundle.schema_version,
            counts: bundle.counts
          }
        });
        return {
          operator_id: operatorId,
          object_manifest_id: manifest.id,
          object_key: manifest.key,
          bytes_written: stored.bytes_written,
          sha256: stored.sha256,
          audit_event_id: audit.id,
          schema_version: bundle.schema_version,
          counts: bundle.counts
        };
      }
    },
    {
      queue: "export",
      type: "run_system_backup_restore_drill",
      async handle(context) {
        if (!context.objectStorage) throw new Error("system backup restore drill requires object storage");
        const operatorId = payloadString(context.job.payload, "operator_id");
        const objectManifestId = payloadString(context.job.payload, "object_manifest_id");
        const manifest = await context.store.getObjectManifest(objectManifestId);
        if (!manifest) {
          const audit = await context.store.appendAuditEvent({
            actor_id: operatorId,
            action: "system_backup_restore_drill_failed",
            object_type: "object_manifest",
            object_id: objectManifestId,
            payload: {
              job_id: context.job.id,
              worker_id: context.workerId,
              error: "backup object manifest was not found"
            }
          });
          throw new Error(
            `system backup restore drill failed: missing manifest ${objectManifestId} (${audit.id})`
          );
        }

        const stored = await context.objectStorage.getObject({
          bucket: manifest.bucket,
          key: manifest.key
        });
        if (!stored) {
          const audit = await context.store.appendAuditEvent({
            actor_id: operatorId,
            action: "system_backup_restore_drill_failed",
            object_type: "object_manifest",
            object_id: objectManifestId,
            payload: {
              job_id: context.job.id,
              worker_id: context.workerId,
              bucket: manifest.bucket,
              key: manifest.key,
              error: "backup object bytes were not found"
            }
          });
          throw new Error(`system backup restore drill failed: missing object ${manifest.key} (${audit.id})`);
        }

        const report = buildSystemBackupRestoreDrillReport({
          operatorId,
          manifest,
          storedManifest: stored.manifest,
          body: stored.body
        });
        const audit = await context.store.appendAuditEvent({
          actor_id: operatorId,
          action: report.passed
            ? "system_backup_restore_drill_completed"
            : "system_backup_restore_drill_failed",
          object_type: "object_manifest",
          object_id: manifest.id,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            passed: report.passed,
            failed_check_ids: report.failed_check_ids,
            counts: report.counts,
            backup_schema_version: report.backup_schema_version
          }
        });
        if (!report.passed) {
          throw new Error(
            `system backup restore drill failed: ${report.failed_check_ids.join(", ")} (${audit.id})`
          );
        }
        return {
          ...report,
          audit_event_id: audit.id
        };
      }
    }
  ];
}

export function createCreatorIngestionWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "ingestion",
      type: "process_creator_submission",
      async handle(context) {
        const request = creatorIngestionJobPayload(context.job.payload);
        const result = await createApiHandlers(context.store).submitCreatorIngestion(request);
        if (!result.ok) {
          throw new Error(result.error?.code ?? "creator ingestion failed");
        }
        const { submission, proposals, risk_flags: riskFlags } = result.data;
        const audit = await context.store.appendAuditEvent({
          actor_id: submission.creator_id,
          action: "creator_ingestion_processed",
          object_type: "creator_ingestion",
          object_id: submission.id,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            status: submission.status,
            proposal_ids: submission.proposal_ids,
            proposal_count: proposals.length,
            risk_flags: riskFlags
          }
        });
        return {
          creator_ingestion_id: submission.id,
          creator_id: submission.creator_id,
          status: submission.status,
          proposal_ids: submission.proposal_ids,
          proposal_count: proposals.length,
          risk_flags: riskFlags,
          audit_event_id: audit.id
        };
      }
    }
  ];
}

export function createLocalArbiterWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "local_ai",
      type: "review_proposal",
      async handle(context) {
        const proposalId = payloadString(context.job.payload, "proposal_id");
        const actorId = payloadString(context.job.payload, "actor_id");
        const proposal = await context.store.getProposal(proposalId);
        if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

        const verdict = arbitrateProposal(proposal);
        const updated = await context.store.saveProposal({
          ...proposal,
          ai_review: verdict as unknown as Record<string, unknown>,
          status: statusForArbiterDecision(verdict.decision),
          updated_at: verdict.created_at
        });
        const audit = await context.store.appendAuditEvent({
          actor_id: actorId,
          action: "proposal_local_arbiter_reviewed",
          object_type: "proposal",
          object_id: proposal.id,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            verdict_id: verdict.id,
            decision: verdict.decision,
            confidence: verdict.confidence,
            status_before: proposal.status,
            status_after: updated.status,
            policy_version: verdict.policy_version,
            model_version: verdict.model_version
          }
        });
        return {
          proposal_id: proposal.id,
          verdict_id: verdict.id,
          decision: verdict.decision,
          confidence: verdict.confidence,
          status_before: proposal.status,
          status_after: updated.status,
          audit_event_id: audit.id
        };
      }
    }
  ];
}

export function createModerationWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "moderation",
      type: "triage_proposal",
      async handle(context) {
        const proposalId = payloadString(context.job.payload, "proposal_id");
        const moderatorId = payloadString(context.job.payload, "moderator_id");
        const proposal = await context.store.getProposal(proposalId);
        if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

        const triage = triageProposalForModeration(proposal);
        const updated = await context.store.saveProposal({
          ...proposal,
          status: triage.next_status,
          expert_comments: [
            ...proposal.expert_comments,
            {
              author_id: moderatorId,
              comment_type: "moderation_triage",
              text: moderationTriageComment(triage),
              triage_id: triage.id,
              required_action: triage.required_action,
              created_at: triage.generated_at
            }
          ],
          updated_at: triage.generated_at
        });
        const audit = await context.store.appendAuditEvent({
          actor_id: moderatorId,
          action: "proposal_moderation_triaged",
          object_type: "proposal",
          object_id: proposal.id,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            triage_id: triage.id,
            required_action: triage.required_action,
            status_before: proposal.status,
            status_after: updated.status,
            reasons: triage.reasons,
            policy_checks: triage.policy_checks,
            source_quality: triage.source_quality,
            opposition_quality: triage.opposition_quality,
            bridging_priority: triage.bridging_priority
          }
        });
        return {
          proposal_id: proposal.id,
          moderation_triage_id: triage.id,
          required_action: triage.required_action,
          status_before: proposal.status,
          status_after: updated.status,
          audit_event_id: audit.id,
          reasons: triage.reasons
        };
      }
    }
  ];
}

export function createOutcomeAnalyticsWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "analytics",
      type: "refresh_outcome_dashboard",
      async handle(context) {
        const userId = payloadString(context.job.payload, "user_id");
        const generatedAt =
          typeof context.job.payload.generated_at === "string" ? context.job.payload.generated_at : undefined;
        const [responses, events, graph] = await Promise.all([
          context.store.listAssessmentResponses(userId),
          context.store.listLearningEvents(userId),
          context.store.getUserGraph(userId)
        ]);
        const dashboard = await context.store.saveOutcomeDashboard(
          buildOutcomeDashboard({
            userId,
            responses,
            events,
            states: graph.states,
            generatedAt
          })
        );
        const audit = await context.store.appendAuditEvent({
          actor_id: userId,
          action: "outcome_dashboard_refreshed",
          object_type: "outcome_dashboard",
          object_id: dashboard.generated_at,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            quality_gates: dashboard.quality_gates,
            learning_velocity: dashboard.learning_velocity,
            retention_risk: dashboard.retention_risk
          }
        });
        return {
          user_id: userId,
          generated_at: dashboard.generated_at,
          audit_event_id: audit.id,
          learning_velocity: dashboard.learning_velocity,
          retention_risk: dashboard.retention_risk,
          quality_gates: dashboard.quality_gates
        };
      }
    }
  ];
}

export function createNotificationWorkerHandlers(): WorkerHandlerDefinition[] {
  return [
    {
      queue: "notification",
      type: "deliver_learning_reminder",
      async handle(context) {
        const notification = notificationPayload(context.job.payload);
        const audit = await context.store.appendAuditEvent({
          actor_id: notification.user_id,
          action: "notification_outbox_recorded",
          object_type: "notification",
          object_id: notification.id,
          payload: {
            job_id: context.job.id,
            worker_id: context.workerId,
            kind: notification.kind,
            channel: notification.channel,
            title: notification.title,
            scheduled_for: notification.scheduled_for,
            delivery_status: notification.channel === "in_app" ? "recorded" : "adapter_ready",
            notification_payload: notification.payload
          }
        });
        return {
          notification_id: notification.id,
          user_id: notification.user_id,
          kind: notification.kind,
          channel: notification.channel,
          scheduled_for: notification.scheduled_for,
          delivery_status: notification.channel === "in_app" ? "recorded" : "adapter_ready",
          audit_event_id: audit.id
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

function moderationTriageComment(triage: ModerationTriage): string {
  return `Moderation triage: ${triage.required_action}. ${triage.reasons.join(" ")}`;
}

function buildSystemBackupRestoreDrillReport(input: {
  operatorId: string;
  manifest: ObjectManifest;
  storedManifest: ObjectManifest;
  body: Uint8Array;
}): SystemBackupRestoreDrillReport {
  const checks: RestoreDrillCheck[] = [];
  const check = (id: string, passed: boolean, detail: string, expected?: unknown, actual?: unknown) => {
    checks.push({
      id,
      status: passed ? "pass" : "fail",
      detail,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual })
    });
  };

  const bodyText = Buffer.from(input.body).toString("utf8");
  const parsed = parseJsonObject(bodyText);
  const backup = parsed.ok ? parsed.value : undefined;
  const counts = recordValue(backup, "counts");
  const global = recordValue(backup, "global");
  const masterGraph = recordValue(backup, "master_graph");
  const users = arrayRecordValue(backup, "users");
  const userGraphStateCount = users.reduce((total, userBundle) => {
    const graph = recordValue(userBundle, "user_graph");
    return total + arrayRecordValue(graph, "states").length;
  }, 0);
  const dailyPacketCount = users.reduce(
    (total, userBundle) => total + arrayRecordValue(userBundle, "daily_packets").length,
    0
  );
  const sleepCuePacketCount = users.reduce(
    (total, userBundle) => total + arrayRecordValue(userBundle, "sleep_cue_packets").length,
    0
  );
  const globalJobs = arrayRecordValue(global, "jobs");
  const globalObjectManifests = arrayRecordValue(global, "object_manifests");
  const globalAuditEvents = arrayRecordValue(global, "audit_events");

  check(
    "manifest_bucket",
    input.manifest.bucket === "backup",
    "Manifest is in the backup bucket.",
    "backup",
    input.manifest.bucket
  );
  check(
    "manifest_content_type",
    input.manifest.content_type === "application/json",
    "Manifest content type is JSON.",
    "application/json",
    input.manifest.content_type
  );
  check(
    "manifest_retention",
    input.manifest.retention_policy === "backup",
    "Manifest retention policy is backup.",
    "backup",
    input.manifest.retention_policy
  );
  check(
    "object_sha256_matches_manifest",
    input.storedManifest.sha256 === input.manifest.sha256,
    "Stored object SHA-256 matches the persisted object manifest.",
    input.manifest.sha256,
    input.storedManifest.sha256
  );
  check(
    "object_size_matches_manifest",
    input.storedManifest.size_bytes === input.manifest.size_bytes,
    "Stored object size matches the persisted object manifest.",
    input.manifest.size_bytes,
    input.storedManifest.size_bytes
  );
  check("json_parsed", parsed.ok, parsed.ok ? "Backup JSON parses." : parsed.error);
  check(
    "schema_version",
    stringValue(backup, "schema_version") === "mnemosyne-system-backup-v0.1",
    "Backup schema version is supported.",
    "mnemosyne-system-backup-v0.1",
    stringValue(backup, "schema_version")
  );
  check("counts_object", Boolean(counts), "Backup includes a counts object.");
  check("master_graph_object", Boolean(masterGraph), "Backup includes a master graph object.");
  check(
    "users_array",
    backup !== undefined && hasRecordArray(backup, "users"),
    "Backup users value is an array of user export bundles."
  );
  check("global_object", Boolean(global), "Backup includes a global records object.");
  check(
    "global_arrays",
    global !== undefined &&
      [
        "jobs",
        "object_manifests",
        "audit_events",
        "proposals",
        "creator_submissions",
        "knowledge_packs",
        "experiments",
        "social_challenges"
      ].every((key) => hasRecordArray(global, key)),
    "Global backup fields are arrays of records."
  );
  check(
    "user_count_matches",
    numberValue(counts, "users") === users.length &&
      numberValue(counts, "user_export_bundles") === users.length,
    "Declared user counts match user export bundles.",
    { users: users.length, user_export_bundles: users.length },
    {
      users: numberValue(counts, "users"),
      user_export_bundles: numberValue(counts, "user_export_bundles")
    }
  );
  check(
    "job_count_matches",
    numberValue(counts, "jobs") === globalJobs.length,
    "Declared job count matches global job records.",
    globalJobs.length,
    numberValue(counts, "jobs")
  );
  check(
    "object_manifest_count_matches",
    numberValue(counts, "object_manifests") === globalObjectManifests.length,
    "Declared object manifest count matches global object manifests.",
    globalObjectManifests.length,
    numberValue(counts, "object_manifests")
  );
  check(
    "audit_event_count_matches",
    numberValue(counts, "audit_events") === globalAuditEvents.length,
    "Declared audit-event count matches global audit events.",
    globalAuditEvents.length,
    numberValue(counts, "audit_events")
  );
  for (const key of [
    "proposals",
    "creator_submissions",
    "knowledge_packs",
    "experiments",
    "social_challenges"
  ]) {
    check(
      `${key}_count_matches`,
      numberValue(counts, key) === arrayRecordValue(global, key).length,
      `Declared ${key} count matches global ${key}.`,
      arrayRecordValue(global, key).length,
      numberValue(counts, key)
    );
  }
  check(
    "user_graph_bundles_valid",
    users.every(isValidUserGraphBundle),
    "Every user bundle has a matching user id and graph-state array."
  );
  check(
    "sleep_packets_owned",
    users.every(hasOwnedSleepPackets),
    "Daily packets and sleep cue packets stay inside their owning user bundle."
  );
  check(
    "privacy_export_fields_present",
    users.every(hasPrivacyExportFields),
    "Each user bundle contains the fields needed by export and deletion flows."
  );
  check(
    "audit_event_ids_unique",
    uniqueStringIds(globalAuditEvents).size === globalAuditEvents.length,
    "Global audit event ids are unique.",
    globalAuditEvents.length,
    uniqueStringIds(globalAuditEvents).size
  );

  const failedCheckIds = checks
    .filter((candidate) => candidate.status === "fail")
    .map((candidate) => candidate.id);
  return {
    schema_version: "mnemosyne-restore-drill-v0.1",
    generated_at: new Date().toISOString(),
    operator_id: input.operatorId,
    object_manifest_id: input.manifest.id,
    object_key: input.manifest.key,
    backup_schema_version: stringValue(backup, "schema_version"),
    passed: failedCheckIds.length === 0,
    checks,
    failed_check_ids: failedCheckIds,
    counts: {
      users: users.length,
      jobs: globalJobs.length,
      object_manifests: globalObjectManifests.length,
      audit_events: globalAuditEvents.length,
      user_graph_states: userGraphStateCount,
      daily_packets: dailyPacketCount,
      sleep_cue_packets: sleepCuePacketCount
    },
    sampled_user_ids: users
      .map((userBundle) => stringValue(userBundle, "user_id"))
      .filter(isString)
      .slice(0, 10)
  };
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`job payload requires ${key}`);
  }
  return value;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseJsonObject(
  json: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) return { ok: false, error: "Backup JSON root is not an object." };
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Backup JSON parse failed."
    };
  }
}

function recordValue(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function arrayRecordValue(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown>[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function hasRecordArray(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return Array.isArray(value) && value.every(isRecord);
}

function isValidUserGraphBundle(userBundle: Record<string, unknown>): boolean {
  const userId = stringValue(userBundle, "user_id");
  const user = recordValue(userBundle, "user");
  const graph = recordValue(userBundle, "user_graph");
  const states = graph?.states;
  return (
    Boolean(userId) &&
    (!user || stringValue(user, "id") === userId) &&
    Array.isArray(states) &&
    states.every((state) => isRecord(state) && typeof state.concept_id === "string")
  );
}

function hasOwnedSleepPackets(userBundle: Record<string, unknown>): boolean {
  const userId = stringValue(userBundle, "user_id");
  if (!userId) return false;
  const dailyPackets = arrayRecordValue(userBundle, "daily_packets");
  const sleepCuePackets = arrayRecordValue(userBundle, "sleep_cue_packets");
  return [...dailyPackets, ...sleepCuePackets].every((packet) => stringValue(packet, "user_id") === userId);
}

function hasPrivacyExportFields(userBundle: Record<string, unknown>): boolean {
  return [
    "goals",
    "daily_packets",
    "sleep_cue_packets",
    "audio_plans",
    "assessment_responses",
    "learning_events",
    "audit_events",
    "sessions",
    "jobs",
    "object_manifests"
  ].every((key) => hasRecordArray(userBundle, key));
}

function uniqueStringIds(records: Record<string, unknown>[]): Set<string> {
  return new Set(records.map((record) => stringValue(record, "id")).filter(isString));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function notificationPayload(payload: Record<string, unknown>): NotificationPlanItem {
  const value = payload.notification;
  if (!isRecord(value)) throw new Error("notification job payload requires notification");
  const notification = value as Partial<NotificationPlanItem>;
  if (
    typeof notification.id !== "string" ||
    typeof notification.user_id !== "string" ||
    typeof notification.kind !== "string" ||
    typeof notification.title !== "string" ||
    typeof notification.body !== "string" ||
    typeof notification.channel !== "string" ||
    typeof notification.scheduled_for !== "string"
  ) {
    throw new Error("notification job payload is incomplete");
  }
  return {
    id: notification.id,
    user_id: notification.user_id,
    kind: notification.kind as NotificationPlanItem["kind"],
    title: notification.title,
    body: notification.body,
    channel: notification.channel as NotificationPlanItem["channel"],
    scheduled_for: notification.scheduled_for,
    priority: notification.priority ?? "normal",
    payload: isRecord(notification.payload) ? notification.payload : {}
  };
}

function creatorIngestionJobPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload.ingestion_request;
  if (!isRecord(value)) throw new Error("creator ingestion job payload requires ingestion_request");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
