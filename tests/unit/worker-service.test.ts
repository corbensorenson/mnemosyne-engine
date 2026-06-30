import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { createJob } from "@mnemosyne/ops-core";
import {
  createWorkerServiceRuntime,
  runWorkerServiceBatch,
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
      MNEMOSYNE_AUDIO_OUTPUT_FORMAT: "wav"
    });
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
});
