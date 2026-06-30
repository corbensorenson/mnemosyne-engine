import {
  buildOpsHealthDashboard,
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
});
