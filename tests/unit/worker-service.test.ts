import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProposal as createCourtProposal } from "@mnemosyne/content-court";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { buildNotificationPlan } from "@mnemosyne/notification-core";
import { createJob, startJob } from "@mnemosyne/ops-core";
import type { AssessmentResponse } from "@mnemosyne/schema";
import {
  createWorkerServiceRuntime,
  runWorkerServiceBatch,
  runWorkerServiceRecovery,
  workerServiceConfigFromEnv
} from "@mnemosyne/worker-service";
import { describe, expect, it } from "vitest";

describe("worker-service", () => {
  it("bootstraps env config and runs scheduler plus audio jobs", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-service-"));
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-service-test",
      MNEMOSYNE_WORKER_MODE: "batch",
      MNEMOSYNE_WORKER_QUEUES: "scheduler,audio_render",
      MNEMOSYNE_WORKER_MAX_JOBS: "2",
      MNEMOSYNE_WORKER_STALE_AFTER_MINUTES: "45",
      MNEMOSYNE_WORKER_RECOVERY_LIMIT: "10",
      MNEMOSYNE_AUDIO_OUTPUT_FORMAT: "wav"
    });
    expect(config.staleAfterMinutes).toBe(45);
    expect(config.recoveryLimit).toBe(10);
    const runtime = await createWorkerServiceRuntime(config);

    try {
      await runtime.store.saveJob(
        createJob({
          queue: "scheduler",
          type: "generate_daily_packet",
          payload: { user_id: demoUser.id },
          priority: "high",
          idempotencyKey: "worker-service-daily",
          auditSubjectId: demoUser.id
        })
      );

      const result = await runWorkerServiceBatch(runtime);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.dead_lettered).toBe(0);

      const dailyPacket = await runtime.store.getDailyPacket(demoUser.id);
      expect(dailyPacket?.user_id).toBe(demoUser.id);
      const audioPlan = dailyPacket
        ? await runtime.store.getAudioPlan(dailyPacket.sleep.audio_plan_id)
        : undefined;
      expect(audioPlan).toEqual(expect.objectContaining({ render_status: "ready" }));

      const manifests = await runtime.store.listObjectManifests(demoUser.id);
      expect(manifests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bucket: "generated_asset",
            content_type: "application/vnd.mnemosyne.audio-render-manifest+json"
          })
        ])
      );
      const stored = await runtime.objectStorage.getObject({
        bucket: "generated_asset",
        key: manifests[0]?.key ?? ""
      });
      expect(JSON.parse(Buffer.from(stored?.body ?? []).toString("utf8"))).toEqual(
        expect.objectContaining({ output_format: "wav" })
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("runs stale-lock recovery mode from worker-service config", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-recovery-"));
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-recovery-test",
      MNEMOSYNE_WORKER_MODE: "recover",
      MNEMOSYNE_WORKER_QUEUES: "scheduler",
      MNEMOSYNE_WORKER_STALE_AFTER_MINUTES: "30",
      MNEMOSYNE_WORKER_RECOVERY_LIMIT: "5"
    });
    const runtime = await createWorkerServiceRuntime(config);

    try {
      const staleJob = await runtime.store.saveJob(
        startJob(
          createJob({
            queue: "scheduler",
            type: "generate_daily_packet",
            payload: { user_id: demoUser.id },
            maxAttempts: 2,
            idempotencyKey: "worker-service-stale",
            auditSubjectId: demoUser.id,
            createdAt: "2026-06-29T09:00:00.000Z"
          }),
          "worker-gone",
          "2026-06-29T09:01:00.000Z"
        )
      );

      const result = await runWorkerServiceRecovery(runtime);
      expect(result.status).toBe("recovered");
      expect(result.recovered).toBe(1);
      expect(result.dead_lettered).toBe(0);
      expect((await runtime.store.getJob(staleJob.id))?.status).toBe("failed");
      expect((await runtime.store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
        "job_recovered"
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("builds privacy export artifacts through the export worker", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-export-"));
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-export-test",
      MNEMOSYNE_WORKER_MODE: "batch",
      MNEMOSYNE_WORKER_QUEUES: "export",
      MNEMOSYNE_WORKER_MAX_JOBS: "1"
    });
    const runtime = await createWorkerServiceRuntime(config);

    try {
      const exportJob = await runtime.store.saveJob(
        createJob({
          queue: "export",
          type: "build_privacy_export",
          payload: { user_id: demoUser.id, requested_at: "2026-06-29T12:00:00.000Z" },
          priority: "high",
          idempotencyKey: "worker-service-export",
          auditSubjectId: demoUser.id,
          createdAt: "2026-06-29T12:00:00.000Z"
        })
      );

      const result = await runWorkerServiceBatch(runtime);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(0);
      expect((await runtime.store.getJob(exportJob.id))?.result).toEqual(
        expect.objectContaining({
          user_id: demoUser.id,
          schema_version: "mnemosyne-export-v0.1"
        })
      );

      const manifest = (await runtime.store.listObjectManifests(demoUser.id)).find(
        (candidate) => candidate.bucket === "export"
      );
      expect(manifest).toEqual(
        expect.objectContaining({
          content_type: "application/json",
          retention_policy: "user_controlled"
        })
      );
      const stored = await runtime.objectStorage.getObject({
        bucket: "export",
        key: manifest?.key ?? ""
      });
      const exported = JSON.parse(Buffer.from(stored?.body ?? []).toString("utf8")) as {
        schema_version?: string;
        user_id?: string;
      };
      expect(exported).toEqual(
        expect.objectContaining({
          schema_version: "mnemosyne-export-v0.1",
          user_id: demoUser.id
        })
      );
      expect((await runtime.store.listAuditEvents(demoUser.id)).map((event) => event.action)).toEqual(
        expect.arrayContaining(["privacy_export_object_stored", "job_completed"])
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("refreshes outcome dashboards through the analytics worker", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-analytics-"));
    const generatedAt = "2026-06-30T12:00:00.000Z";
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-analytics-test",
      MNEMOSYNE_WORKER_MODE: "batch",
      MNEMOSYNE_WORKER_QUEUES: "analytics",
      MNEMOSYNE_WORKER_MAX_JOBS: "1"
    });
    const runtime = await createWorkerServiceRuntime(config);

    try {
      await runtime.store.saveAssessmentResponse(
        outcomeResponse("worker_outcome_immediate", "attention_qkv", "2026-06-30T10:30:00.000Z")
      );
      const analyticsJob = await runtime.store.saveJob(
        createJob({
          queue: "analytics",
          type: "refresh_outcome_dashboard",
          payload: { user_id: demoUser.id, generated_at: generatedAt },
          priority: "normal",
          idempotencyKey: "worker-service-analytics",
          auditSubjectId: demoUser.id,
          createdAt: "2026-06-29T12:00:00.000Z"
        })
      );

      const result = await runWorkerServiceBatch(runtime);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(0);
      expect((await runtime.store.getJob(analyticsJob.id))?.result).toEqual(
        expect.objectContaining({
          user_id: demoUser.id,
          generated_at: generatedAt,
          learning_velocity: expect.any(Number)
        })
      );
      const dashboard = await runtime.store.getLatestOutcomeDashboard(demoUser.id);
      expect(dashboard).toEqual(
        expect.objectContaining({
          user_id: demoUser.id,
          generated_at: generatedAt,
          quality_gates: expect.objectContaining({ immediate_recall_measured: true })
        })
      );
      expect((await runtime.store.listAuditEvents(demoUser.id)).map((event) => event.action)).toEqual(
        expect.arrayContaining(["outcome_dashboard_refreshed", "job_completed"])
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("records notification outbox reminders through the notification worker", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-notification-"));
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-notification-test",
      MNEMOSYNE_WORKER_MODE: "batch",
      MNEMOSYNE_WORKER_QUEUES: "notification",
      MNEMOSYNE_WORKER_MAX_JOBS: "1"
    });
    const runtime = await createWorkerServiceRuntime(config);

    try {
      const plan = buildNotificationPlan({
        user: demoUser,
        generatedAt: "2026-06-29T06:00:00.000Z",
        channel: "in_app"
      });
      const notification = plan.items.find((item) => item.kind === "morning_prompt");
      if (!notification) throw new Error("missing morning notification");
      const notificationJob = await runtime.store.saveJob(
        createJob({
          queue: "notification",
          type: "deliver_learning_reminder",
          payload: { notification, plan_generated_at: plan.generated_at },
          priority: "high",
          idempotencyKey: "worker-service-notification",
          auditSubjectId: demoUser.id,
          runAfter: "2026-06-29T08:00:00.000Z",
          createdAt: "2026-06-29T06:00:00.000Z"
        })
      );

      const result = await runWorkerServiceBatch(runtime);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(0);
      expect((await runtime.store.getJob(notificationJob.id))?.result).toEqual(
        expect.objectContaining({
          notification_id: notification.id,
          delivery_status: "recorded"
        })
      );
      expect((await runtime.store.listAuditEvents(demoUser.id)).map((event) => event.action)).toEqual(
        expect.arrayContaining(["notification_outbox_recorded", "job_completed"])
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });

  it("triages proposal moderation jobs through the moderation worker", async () => {
    const objectStorageRoot = await mkdtemp(join(tmpdir(), "mnemosyne-worker-moderation-"));
    const config = workerServiceConfigFromEnv({
      MNEMOSYNE_STORAGE: "memory",
      MNEMOSYNE_SEED_DEMO: "true",
      MNEMOSYNE_OBJECT_STORAGE_ROOT: objectStorageRoot,
      MNEMOSYNE_WORKER_ID: "worker-moderation-test",
      MNEMOSYNE_WORKER_MODE: "batch",
      MNEMOSYNE_WORKER_QUEUES: "moderation",
      MNEMOSYNE_WORKER_MAX_JOBS: "1"
    });
    const runtime = await createWorkerServiceRuntime(config);

    try {
      const proposal = await runtime.store.saveProposal(
        createCourtProposal({
          proposerId: demoUser.id,
          proposalType: "add_claim",
          affectedObjectIds: ["claim_sleep_medical_worker"],
          diff: {
            add_claim: {
              subject_id: "sleep",
              object_value: "medical diagnosis and dosage advice"
            },
            security_review: {
              high_stakes_detected: true,
              requires_expert_review: true
            }
          },
          rationale: "High-stakes creator claims need human moderation before graph release.",
          riskLevel: "low"
        })
      );
      expect(proposal.status).toBe("open");

      const moderationJob = await runtime.store.saveJob(
        createJob({
          queue: "moderation",
          type: "triage_proposal",
          payload: { proposal_id: proposal.id, moderator_id: demoUser.id },
          priority: "high",
          idempotencyKey: "worker-service-moderation",
          auditSubjectId: demoUser.id,
          createdAt: "2026-06-29T12:00:00.000Z"
        })
      );

      const result = await runWorkerServiceBatch(runtime);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(0);
      expect((await runtime.store.getJob(moderationJob.id))?.result).toEqual(
        expect.objectContaining({
          proposal_id: proposal.id,
          required_action: "send_to_human_moderation",
          status_before: "open",
          status_after: "human_review_required"
        })
      );
      const updated = await runtime.store.getProposal(proposal.id);
      expect(updated?.status).toBe("human_review_required");
      expect(updated?.expert_comments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            author_id: demoUser.id,
            comment_type: "moderation_triage",
            required_action: "send_to_human_moderation"
          })
        ])
      );
      expect((await runtime.store.listAuditEvents(demoUser.id)).map((event) => event.action)).toEqual(
        expect.arrayContaining(["proposal_moderation_triaged", "job_completed"])
      );
    } finally {
      await runtime.close();
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
  });
});

function outcomeResponse(id: string, conceptId: string, createdAt: string): AssessmentResponse {
  return {
    id,
    user_id: demoUser.id,
    assessment_item_id: `item_${id}`,
    raw_response: "durable answer",
    correctness_score: 0.82,
    semantic_score: 0.8,
    latency_ms: 24_000,
    confidence_reported: 0.75,
    hint_count: 0,
    retries: 0,
    detected_failure_modes: [],
    misconception_ids: [],
    model_feedback: "worker outcome scored",
    graph_updates: [{ concept_id: conceptId }],
    created_at: createdAt
  };
}
