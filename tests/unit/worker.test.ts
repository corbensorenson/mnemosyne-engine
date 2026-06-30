import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAudioRendererWorkerHandlers } from "@mnemosyne/audio-renderer-service";
import { seedDemoStore } from "@mnemosyne/api";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { createJob, startJob } from "@mnemosyne/ops-core";
import { createMemoryStore } from "@mnemosyne/persistence-core";
import { createSchedulerWorkerHandlers } from "@mnemosyne/scheduler-service";
import { createLocalObjectStorage } from "@mnemosyne/storage-core";
import { createWorkerHandlerRegistry, recoverStaleWorkerLocks, runWorkerOnce } from "@mnemosyne/worker-core";
import { describe, expect, it } from "vitest";

describe("worker-core", () => {
  it("leases only jobs with registered handlers", async () => {
    const store = createMemoryStore();
    await seedDemoStore(store);
    const handlers = createWorkerHandlerRegistry(createSchedulerWorkerHandlers());
    await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "unregistered_job",
        payload: { user_id: demoUser.id },
        priority: "critical",
        idempotencyKey: "unhandled"
      })
    );
    const handled = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: demoUser.id },
        priority: "normal",
        idempotencyKey: "handled"
      })
    );

    const result = await runWorkerOnce({
      store,
      workerId: "worker-scheduler",
      handlers,
      queues: ["scheduler"]
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Scheduler worker did not complete.");
    expect(result.job.id).toBe(handled.id);
    expect((await store.getJob(handled.id))?.status).toBe("completed");
  });

  it("runs scheduler and audio render jobs through first-party workers", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemosyne-worker-objects-"));
    const objectStorage = createLocalObjectStorage(root);
    const store = createMemoryStore();
    await seedDemoStore(store);
    const handlers = createWorkerHandlerRegistry([
      ...createSchedulerWorkerHandlers(),
      ...createAudioRendererWorkerHandlers("m4a")
    ]);
    const schedulerJob = await store.saveJob(
      createJob({
        queue: "scheduler",
        type: "generate_daily_packet",
        payload: { user_id: demoUser.id },
        priority: "high",
        idempotencyKey: "daily:user_demo",
        auditSubjectId: demoUser.id,
        createdAt: "2026-06-30T08:00:00.000Z"
      })
    );

    try {
      const scheduled = await runWorkerOnce({
        store,
        workerId: "worker-scheduler",
        handlers,
        queues: ["scheduler"],
        objectStorage,
        now: "2026-06-30T08:01:00.000Z"
      });

      expect(scheduled.status).toBe("completed");
      if (scheduled.status !== "completed") throw new Error("Scheduler worker did not complete.");
      expect(scheduled.job.id).toBe(schedulerJob.id);
      expect(scheduled.result.daily_packet_id).toBeTruthy();
      expect(scheduled.result.queued_audio_job_id).toBeTruthy();
      expect(await store.getDailyPacket(demoUser.id)).toEqual(
        expect.objectContaining({ id: scheduled.result.daily_packet_id })
      );

      const rendered = await runWorkerOnce({
        store,
        workerId: "worker-audio",
        handlers,
        queues: ["audio_render"],
        objectStorage,
        now: "2026-06-30T08:02:00.000Z"
      });

      expect(rendered.status).toBe("completed");
      if (rendered.status !== "completed") throw new Error("Audio worker did not complete.");
      expect(rendered.result.object_manifest_id).toBeTruthy();
      const manifest = await store.getObjectManifest(String(rendered.result.object_manifest_id));
      expect(manifest).toEqual(
        expect.objectContaining({
          bucket: "generated_asset",
          owner_id: demoUser.id,
          content_type: "application/vnd.mnemosyne.audio-render-manifest+json"
        })
      );
      const stored = await objectStorage.getObject({
        bucket: "generated_asset",
        key: manifest?.key ?? ""
      });
      expect(stored?.manifest.sha256).toBe(manifest?.sha256);
      expect(JSON.parse(Buffer.from(stored?.body ?? []).toString("utf8"))).toEqual(
        expect.objectContaining({ output_format: "m4a" })
      );

      const jobs = await store.listJobs();
      expect(jobs.filter((job) => job.status === "completed").map((job) => job.type)).toEqual([
        "generate_daily_packet",
        "render_sleep_audio"
      ]);
      const auditEvents = await store.listAuditEvents(demoUser.id);
      const auditActions = auditEvents.map((event) => event.action);
      expect(auditActions).toEqual(
        expect.arrayContaining(["job_started", "job_completed", "job_started", "job_completed"])
      );
      expect(auditEvents.map((event) => event.payload.worker_id)).toEqual(
        expect.arrayContaining(["worker-scheduler", "worker-audio"])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dead-letters exhausted worker failures with an audit trail", async () => {
    const store = createMemoryStore();
    await seedDemoStore(store);
    const handlers = createWorkerHandlerRegistry(createAudioRendererWorkerHandlers("m4a"));
    const job = await store.saveJob(
      createJob({
        queue: "audio_render",
        type: "render_sleep_audio",
        payload: { audio_plan_id: "missing_audio_plan" },
        maxAttempts: 1,
        idempotencyKey: "missing_audio_plan",
        auditSubjectId: demoUser.id
      })
    );

    const result = await runWorkerOnce({
      store,
      workerId: "worker-audio",
      handlers,
      queues: ["audio_render"]
    });

    expect(result.status).toBe("dead_lettered");
    if (result.status !== "dead_lettered") throw new Error("Audio worker did not dead-letter the job.");
    expect(result.job.id).toBe(job.id);
    expect(result.error).toContain("unknown audio plan");
    expect((await store.getJob(job.id))?.status).toBe("dead_lettered");
    expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toContain(
      "job_dead_lettered"
    );
  });

  it("recovers stale worker locks for retry or dead-letter with audit events", async () => {
    const store = createMemoryStore();
    await seedDemoStore(store);
    const retryable = await store.saveJob(
      startJob(
        createJob({
          queue: "scheduler",
          type: "generate_daily_packet",
          payload: { user_id: demoUser.id },
          maxAttempts: 2,
          idempotencyKey: "stale_retryable",
          auditSubjectId: demoUser.id,
          createdAt: "2026-06-30T09:00:00.000Z"
        }),
        "worker-gone",
        "2026-06-30T09:01:00.000Z"
      )
    );
    const exhausted = await store.saveJob(
      startJob(
        createJob({
          queue: "audio_render",
          type: "render_sleep_audio",
          payload: { audio_plan_id: "missing" },
          maxAttempts: 1,
          idempotencyKey: "stale_exhausted",
          auditSubjectId: demoUser.id,
          createdAt: "2026-06-30T09:02:00.000Z"
        }),
        "worker-gone",
        "2026-06-30T09:03:00.000Z"
      )
    );

    const result = await recoverStaleWorkerLocks({
      store,
      workerId: "worker-maintenance",
      staleAfterMinutes: 30,
      now: "2026-06-30T09:45:00.000Z"
    });

    expect(result.recovered).toBe(2);
    expect(result.dead_lettered).toBe(1);
    expect(await store.getJob(retryable.id)).toEqual(
      expect.objectContaining({
        status: "failed",
        locked_at: undefined,
        locked_by: undefined,
        run_after: "2026-06-30T09:45:00.000Z"
      })
    );
    expect(await store.getJob(exhausted.id)).toEqual(
      expect.objectContaining({
        status: "dead_lettered",
        locked_at: undefined,
        locked_by: undefined
      })
    );
    expect((await store.listAuditEvents(demoUser.id)).map((event) => event.action)).toEqual(
      expect.arrayContaining(["job_recovered", "job_dead_lettered"])
    );
  });
});
