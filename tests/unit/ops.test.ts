import {
  buildOpsHealthDashboard,
  buildOpsMonitoringDashboard,
  createJob,
  createObjectManifest,
  failJob,
  startJob
} from "@mnemosyne/ops-core";
import { describe, expect, it } from "vitest";

describe("ops-core", () => {
  it("runs idempotent jobs through retries and dead letters exhausted work", () => {
    const queued = createJob({
      queue: "audio_render",
      type: "render_sleep_audio",
      payload: { audio_plan_id: "audio_demo" },
      priority: "high",
      maxAttempts: 2,
      idempotencyKey: "audio_demo",
      createdAt: "2026-06-30T10:00:00.000Z"
    });

    expect(queued.id).toBe(
      createJob({
        queue: "audio_render",
        type: "render_sleep_audio",
        payload: { audio_plan_id: "audio_demo" },
        idempotencyKey: "audio_demo",
        createdAt: "2026-06-30T10:10:00.000Z"
      }).id
    );

    const firstRun = startJob(queued, "worker-audio", "2026-06-30T10:01:00.000Z");
    const retryable = failJob(firstRun, "renderer warmup failed", "2026-06-30T10:02:00.000Z");
    expect(retryable.status).toBe("failed");

    const secondRun = startJob(retryable, "worker-audio", "2026-06-30T10:03:00.000Z");
    const deadLetter = failJob(secondRun, "codec unavailable", "2026-06-30T10:04:00.000Z");
    expect(deadLetter.status).toBe("dead_lettered");
    expect(deadLetter.attempts).toBe(2);
  });

  it("summarizes queue and object storage release gates", () => {
    const completed = {
      ...startJob(
        createJob({
          queue: "export",
          type: "build_privacy_export",
          payload: { user_id: "user_demo" },
          idempotencyKey: "export_demo",
          createdAt: "2026-06-30T10:00:00.000Z"
        }),
        "worker-export",
        "2026-06-30T10:01:00.000Z"
      ),
      status: "completed" as const,
      completed_at: "2026-06-30T10:02:00.000Z",
      updated_at: "2026-06-30T10:02:00.000Z"
    };
    const object = createObjectManifest({
      bucket: "export",
      key: "exports/user_demo/export.json",
      contentType: "application/json",
      sizeBytes: 4096,
      sha256: "a".repeat(64),
      ownerId: "user_demo",
      retentionPolicy: "user_controlled",
      createdAt: "2026-06-30T10:02:00.000Z"
    });

    const dashboard = buildOpsHealthDashboard({
      jobs: [completed],
      objects: [object],
      generatedAt: "2026-06-30T10:05:00.000Z"
    });

    expect(dashboard.totals.jobs).toBe(1);
    expect(dashboard.totals.objects).toBe(1);
    expect(dashboard.objects.find((summary) => summary.bucket === "export")?.total_bytes).toBe(4096);
    expect(dashboard.release_gates).toEqual({
      queues_configured: true,
      no_dead_letters: true,
      no_stale_running_jobs: true,
      objects_encrypted: true,
      object_integrity_tracked: true,
      idempotency_keys_present: true
    });
    expect(dashboard.ready_for_release).toBe(true);
  });

  it("turns release, dependency, security, and storage failures into monitoring alerts", () => {
    const staleRunning = startJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: "user_demo" },
        idempotencyKey: "daily_demo",
        createdAt: "2026-06-30T10:00:00.000Z"
      }),
      "worker-scheduler",
      "2026-06-30T10:01:00.000Z"
    );
    const deadLetter = failJob(
      startJob(
        createJob({
          queue: "audio_render",
          type: "render_sleep_audio",
          payload: { audio_plan_id: "audio_demo" },
          maxAttempts: 1,
          idempotencyKey: "audio_demo",
          createdAt: "2026-06-30T10:02:00.000Z"
        }),
        "worker-audio",
        "2026-06-30T10:03:00.000Z"
      ),
      "encoder crashed",
      "2026-06-30T10:04:00.000Z"
    );
    const untrustedObject = createObjectManifest({
      bucket: "audio",
      key: "audio/untrusted.m4a",
      contentType: "audio/mp4",
      sizeBytes: 512,
      sha256: "not-a-sha",
      ownerId: "user_demo",
      encryption: { mode: "managed", status: "pending" },
      createdAt: "2026-06-30T10:05:00.000Z"
    });

    const opsHealth = buildOpsHealthDashboard({
      jobs: [staleRunning, deadLetter],
      objects: [untrustedObject],
      generatedAt: "2026-06-30T11:00:00.000Z"
    });
    const monitoring = buildOpsMonitoringDashboard({
      opsHealth,
      securityGate: {
        passed: false,
        csp_present: true,
        csrf_required_for_mutation: false,
        rate_limits_present: true,
        high_stakes_labeled: true,
        expert_review_required_when_high_stakes: true,
        audit_safe: true
      },
      dependencyReadiness: {
        service: "mnemosyne-api",
        status: "not_ready",
        environment: "production",
        checked_at: "2026-06-30T11:00:00.000Z",
        components: {
          store: { status: "ok", checked_at: "2026-06-30T11:00:00.000Z" },
          object_storage: {
            status: "error",
            checked_at: "2026-06-30T11:00:00.000Z",
            message: "Object storage adapter is not configured."
          }
        }
      }
    });

    expect(monitoring.status).toBe("critical");
    expect(monitoring.ready_for_release).toBe(false);
    expect(monitoring.alert_counts.critical).toBeGreaterThanOrEqual(6);
    expect(monitoring.alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining([
        "ops.dependency.object_storage",
        "ops.release.dead_letters",
        "ops.release.stale_running_jobs",
        "ops.release.objects_encrypted",
        "ops.release.object_integrity",
        "ops.security.release_gate"
      ])
    );
    expect(monitoring.service_levels.find((level) => level.service === "security")?.status).toBe("critical");
  });
});
