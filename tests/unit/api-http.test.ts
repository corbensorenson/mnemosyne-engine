import { createSeededDemoApiHttpServer } from "@mnemosyne/api";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { createOfflineQueueItem } from "@mnemosyne/offline-core";
import type { RateLimitPolicy } from "@mnemosyne/security-core";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";

type ApiJson = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

describe("API HTTP adapter", () => {
  it("separates cheap liveness from dependency-backed readiness", async () => {
    const { server } = await createSeededDemoApiHttpServer({
      environment: "local"
    });
    const baseUrl = await listen(server);

    try {
      const health = await fetch(`${baseUrl}/healthz`);
      const healthBody = (await health.json()) as ApiJson;
      expect(health.status).toBe(200);
      expect(healthBody.data).toEqual(
        expect.objectContaining({
          service: "mnemosyne-api",
          status: "live"
        })
      );

      const ready = await fetch(`${baseUrl}/readyz`);
      const readyBody = (await ready.json()) as ApiJson;
      expect(ready.status).toBe(503);
      expect(readyBody.ok).toBe(false);
      expect(readyBody.error?.code).toBe("service_not_ready");
      expect(readyBody.data?.components).toEqual(
        expect.objectContaining({
          store: expect.objectContaining({ status: "ok" }),
          object_storage: expect.objectContaining({ status: "error" })
        })
      );
    } finally {
      await close(server);
    }
  });

  it("serves handler envelopes with first-party security headers", async () => {
    const { server } = await createSeededDemoApiHttpServer({
      environment: "production",
      csrfMode: "enforce"
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(
        `${baseUrl}/api/security/release-gate?userId=${demoUser.id}&environment=production`
      );
      const body = (await response.json()) as ApiJson;

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(body.ok).toBe(true);
      expect(body.data?.release_gate).toEqual(expect.objectContaining({ passed: true }));

      const reliability = await fetch(
        `${baseUrl}/api/reliability/release-gate?userId=${demoUser.id}&environment=production`
      );
      const reliabilityBody = (await reliability.json()) as ApiJson;
      expect(reliability.status).toBe(200);
      expect(reliabilityBody.data).toEqual(
        expect.objectContaining({
          schema_version: "mnemosyne-reliability-release-gate-v0.1",
          passed: true
        })
      );
    } finally {
      await close(server);
    }
  });

  it("serves persisted app bootstrap state through the HTTP adapter", async () => {
    const { server } = await createSeededDemoApiHttpServer({
      environment: "local"
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(
        `${baseUrl}/api/app/bootstrap?userId=${demoUser.id}&generateMissingPacket=true`
      );
      const body = (await response.json()) as ApiJson;

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual(
        expect.objectContaining({
          user: expect.objectContaining({ id: demoUser.id }),
          daily_packet_source: "generated"
        })
      );
    } finally {
      await close(server);
    }
  });

  it("enforces CSRF headers on mutating production requests", async () => {
    const { server } = await createSeededDemoApiHttpServer({
      environment: "production",
      csrfMode: "enforce"
    });
    const baseUrl = await listen(server);
    const goalBody = {
      userId: demoUser.id,
      title: "Practical probability",
      description: "Build reliable probability intuition.",
      goalType: "skill",
      targetConceptIds: [],
      targetDomainIds: [],
      priority: 0.7,
      intensity: "normal",
      desiredModalities: ["text"],
      avoidModalities: []
    };

    try {
      const blocked = await postJson(`${baseUrl}/api/goals`, goalBody);
      const blockedBody = (await blocked.json()) as ApiJson;
      expect(blocked.status).toBe(403);
      expect(blockedBody.error?.code).toBe("csrf_required");

      const allowed = await postJson(`${baseUrl}/api/goals`, goalBody, {
        "X-CSRF-Token": "demo-csrf"
      });
      const allowedBody = (await allowed.json()) as ApiJson;
      expect(allowed.status).toBe(200);
      expect(allowedBody.ok).toBe(true);
      expect(allowedBody.data?.title).toBe("Practical probability");
    } finally {
      await close(server);
    }
  });

  it("accepts browser offline sync receipts through the HTTP adapter", async () => {
    const { server } = await createSeededDemoApiHttpServer({
      environment: "local"
    });
    const baseUrl = await listen(server);
    const item = createOfflineQueueItem({
      userId: demoUser.id,
      actionType: "graphfeed_recall",
      endpoint: "/api/watch-packets/local/complete",
      method: "POST",
      payload: { recall_passed: true, video_id: "video_demo" },
      idempotencyKey: "offline-http-graphfeed"
    });

    try {
      const response = await postJson(`${baseUrl}/api/offline/actions/sync`, { item });
      const body = (await response.json()) as ApiJson;

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual(
        expect.objectContaining({
          status: "accepted",
          item_id: item.id,
          action_type: "graphfeed_recall"
        })
      );
    } finally {
      await close(server);
    }
  });

  it("enforces first-party rate-limit policies before expensive handlers", async () => {
    const privacyExportLimit: RateLimitPolicy = {
      key: "privacy_export",
      scope: "user",
      window_seconds: 60,
      max_requests: 1,
      burst: 0,
      expensive: true
    };
    const { server } = await createSeededDemoApiHttpServer({
      environment: "local",
      rateLimitPolicies: [privacyExportLimit]
    });
    const baseUrl = await listen(server);
    const url = `${baseUrl}/api/privacy/export?userId=${demoUser.id}`;

    try {
      const first = await fetch(url);
      const second = await fetch(url);
      const secondBody = (await second.json()) as ApiJson;

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
      expect(secondBody.error?.code).toBe("rate_limit_exceeded");
    } finally {
      await close(server);
    }
  });

  it("derives rate-limit subjects from the configured policy scope", async () => {
    const authIpLimit: RateLimitPolicy = {
      key: "auth_session",
      scope: "ip",
      window_seconds: 60,
      max_requests: 1,
      burst: 0,
      expensive: true
    };
    const { server } = await createSeededDemoApiHttpServer({
      environment: "local",
      rateLimitPolicies: [authIpLimit]
    });
    const baseUrl = await listen(server);

    try {
      const first = await postJson(`${baseUrl}/api/auth/session`, {
        userId: demoUser.id,
        provider: "passkey",
        roles: ["learner"],
        ttlMinutes: 30,
        sessionSeed: "first-auth-session",
        csrfSeed: "first-auth-csrf"
      });
      const second = await postJson(`${baseUrl}/api/auth/session`, {
        userId: "rotated_user_id",
        provider: "passkey",
        roles: ["learner"],
        ttlMinutes: 30,
        sessionSeed: "second-auth-session",
        csrfSeed: "second-auth-csrf"
      });
      const secondBody = (await second.json()) as ApiJson;

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(secondBody.error?.code).toBe("rate_limit_exceeded");
      expect(second.headers.get("x-ratelimit-key")).toContain("auth_session:ip:");
    } finally {
      await close(server);
    }
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}
