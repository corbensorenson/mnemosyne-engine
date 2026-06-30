import { createOfflineQueueItem } from "@mnemosyne/offline-core";
import { demoMasterGraph } from "@mnemosyne/demo-fixtures";
import { describe, expect, it } from "vitest";
import { offlineSyncRequestForItem } from "../../apps/web/src/offlineSync";

const prompt = {
  id: "assessment_demo",
  concept_ids: [demoMasterGraph.concepts[0]?.id ?? "concept_demo"],
  assessment_type: "free_recall" as const,
  prompt: "Explain the concept.",
  expected_answer: "A clear explanation.",
  rubric: {
    must_include: ["mechanism"],
    partial_credit: [],
    disallow: []
  },
  difficulty: 0.4,
  created_at: "2026-06-30T08:00:00.000Z"
};

describe("web offline sync transport", () => {
  it("routes backend-compatible Morning Forge queue items to the domain completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        dailyPacketId: "daily_packet_demo",
        packetDate: "2026-06-30",
        responses: [
          {
            item: prompt,
            rawResponse: "A clear explanation.",
            confidence: 0.8,
            latencyMs: 12_000,
            entryMode: "text"
          }
        ],
        screenMinutes: 0.2,
        voiceUsed: false,
        completedAt: "2026-06-30T08:05:00.000Z"
      },
      idempotencyKey: "morning-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/morning-forge/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy or receipt-only payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: {
        daily_packet_id: "daily_packet_demo",
        response: { response_id: "local_only" }
      },
      idempotencyKey: "legacy-morning-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });

  it("routes backend-compatible WalkMode queue items to the domain completion endpoint", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "walk_mode_completion",
      endpoint: "/api/walk-mode/complete",
      method: "POST",
      payload: {
        userId: "user_demo",
        dailyPacketId: "daily_packet_demo",
        packetDate: "2026-06-30",
        walkPacketId: "walk_packet_demo",
        responses: [
          {
            item: prompt,
            rawResponse: "A clear walking recall answer.",
            confidence: 0.74,
            latencyMs: 18_000,
            hintCount: 1,
            entryMode: "voice"
          }
        ],
        skippedPromptIds: ["walk_skip"],
        confusingPromptIds: ["walk_confusing"],
        commandLog: ["listen", "give hint"],
        screenLocked: true,
        voiceUsed: true,
        transcriptRetention: "deleted",
        completedAt: "2026-06-30T08:10:00.000Z"
      },
      idempotencyKey: "walk-domain-write"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787/", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/walk-mode/complete",
        body: item.payload,
        directDomainWrite: true
      })
    );
  });

  it("keeps legacy WalkMode payloads on the offline receipt route", () => {
    const item = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "walk_mode_completion",
      endpoint: "/api/walk-mode/complete",
      method: "POST",
      payload: {
        walk_packet_id: "walk_packet_demo",
        responses: [{ response_id: "local_only" }]
      },
      idempotencyKey: "legacy-walk-receipt"
    });

    const request = offlineSyncRequestForItem("http://127.0.0.1:8787", item);

    expect(request).toEqual(
      expect.objectContaining({
        url: "http://127.0.0.1:8787/api/offline/actions/sync",
        body: { item },
        directDomainWrite: false
      })
    );
  });
});
