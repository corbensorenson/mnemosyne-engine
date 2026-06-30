import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment config", () => {
  it("defines first-party API and worker compose services", async () => {
    const compose = await readFile("infra/docker/docker-compose.yml", "utf8");
    const dockerfile = await readFile("infra/docker/Dockerfile", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        "docker:config": "docker compose -f infra/docker/docker-compose.yml config",
        "docker:up": "docker compose -f infra/docker/docker-compose.yml up --build",
        "docker:down": "docker compose -f infra/docker/docker-compose.yml down"
      })
    );
    expect(dockerfile).toContain("FROM node:22.13.0-slim");
    expect(dockerfile).toContain("npm ci --omit=optional");
    expect(compose).toContain("api:");
    expect(compose).toContain("worker-scheduler:");
    expect(compose).toContain("worker-audio:");
    expect(compose).toContain("worker-export:");
    expect(compose).toContain("worker-analytics:");
    expect(compose).toContain("worker-notification:");
    expect(compose).toContain("MNEMOSYNE_STORAGE: postgres");
    expect(compose).toContain('MNEMOSYNE_RUN_MIGRATIONS: "true"');
    expect(compose).toContain("MNEMOSYNE_WORKER_QUEUES: scheduler");
    expect(compose).toContain("MNEMOSYNE_WORKER_QUEUES: audio_render");
    expect(compose).toContain("MNEMOSYNE_WORKER_QUEUES: export");
    expect(compose).toContain("MNEMOSYNE_WORKER_QUEUES: analytics");
    expect(compose).toContain("MNEMOSYNE_WORKER_QUEUES: notification");
    expect(compose).toContain("object-storage:/var/lib/mnemosyne/objects");
    expect(compose).toContain("condition: service_healthy");
  });
});
