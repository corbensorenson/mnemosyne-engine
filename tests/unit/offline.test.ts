import {
  buildOfflineReleaseGate,
  createOfflineQueueItem,
  defaultOfflineRequiredActions,
  markOfflineItemSyncing,
  recoverStaleOfflineItems,
  summarizeOfflineQueue,
  syncOfflineQueueItems
} from "@mnemosyne/offline-core";
import { describe, expect, it } from "vitest";

describe("offline-core", () => {
  it("summarizes queued actions and passes the PWA offline release gate", () => {
    const items = defaultOfflineRequiredActions.map((actionType, index) =>
      createOfflineQueueItem({
        userId: "user_demo",
        actionType,
        endpoint: `/api/offline/${actionType}`,
        method: index === 0 ? "GET" : "POST",
        payload: { action_type: actionType, sequence: index },
        idempotencyKey: `user_demo:${actionType}:release-probe`,
        createdAt: `2026-06-30T12:${String(index).padStart(2, "0")}:00.000Z`
      })
    );

    const summary = summarizeOfflineQueue(items, {
      generatedAt: "2026-06-30T13:00:00.000Z"
    });
    const gate = buildOfflineReleaseGate({
      items,
      serviceWorkerRegistered: true,
      manifestPresent: true,
      indexedDbAvailable: true,
      syncRecoveryChecked: true,
      generatedAt: "2026-06-30T13:00:00.000Z"
    });

    expect(summary.total).toBe(defaultOfflineRequiredActions.length);
    expect(summary.queued).toBe(defaultOfflineRequiredActions.length);
    expect(summary.coverage).toEqual(expect.arrayContaining(defaultOfflineRequiredActions));
    expect(gate.schema_version).toBe("mnemosyne-offline-release-gate-v0.1");
    expect(gate.passed).toBe(true);
    expect(gate.score).toBe(1);
    expect(gate.missing_actions).toEqual([]);
  });

  it("fails closed for unsafe payloads and stale sync locks, then recovers retryable work", () => {
    const safe = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "walk_mode_completion",
      endpoint: "/api/walk-mode/complete",
      method: "POST",
      payload: { walk_packet_id: "walk_1" },
      idempotencyKey: "safe-walk"
    });
    const unsafe = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "privacy_operation",
      endpoint: "/api/privacy/export",
      method: "GET",
      payload: { access_token: "should-not-enter-offline-queue" },
      idempotencyKey: "unsafe-privacy"
    });
    const stale = markOfflineItemSyncing(
      createOfflineQueueItem({
        userId: "user_demo",
        actionType: "sleep_playback_event",
        endpoint: "/api/sleep/playback/events",
        method: "POST",
        payload: { sleep_packet_id: "sleep_1" },
        idempotencyKey: "stale-sleep"
      }),
      "worker-offline",
      "2026-06-30T12:00:00.000Z"
    );

    const gate = buildOfflineReleaseGate({
      items: [safe, unsafe, stale],
      serviceWorkerRegistered: true,
      manifestPresent: true,
      indexedDbAvailable: true,
      syncRecoveryChecked: false,
      generatedAt: "2026-06-30T12:30:00.000Z"
    });
    const recovered = recoverStaleOfflineItems([safe, unsafe, stale], {
      at: "2026-06-30T12:30:00.000Z",
      staleAfterMinutes: 15
    });

    expect(gate.passed).toBe(false);
    expect(gate.checks.privacy_safe_payloads).toBe(false);
    expect(gate.checks.no_stale_syncing_items).toBe(false);
    expect(gate.remediation.join(" ")).toContain("Remove secrets");
    expect(recovered.find((item) => item.id === stale.id)?.status).toBe("queued");
    expect(recovered.find((item) => item.id === stale.id)?.last_error).toBe(
      "Recovered stale offline sync lock."
    );
  });

  it("syncs retryable items through a receipt transport and preserves failures for retry", async () => {
    const accepted = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "morning_forge_response",
      endpoint: "/api/morning-forge/complete",
      method: "POST",
      payload: { response_id: "response_ok" },
      idempotencyKey: "accepted-response"
    });
    const rejected = createOfflineQueueItem({
      userId: "user_demo",
      actionType: "sleep_recall_completion",
      endpoint: "/api/sleep/recall/complete",
      method: "POST",
      payload: { response_id: "response_bad" },
      idempotencyKey: "rejected-response"
    });

    const run = await syncOfflineQueueItems({
      items: [accepted, rejected],
      at: "2026-06-30T14:00:00.000Z",
      workerId: "test-sync",
      transport: async (item) =>
        item.id === accepted.id
          ? { ok: true, statusCode: 202, receiptId: "receipt_ok" }
          : { ok: false, statusCode: 503, error: "API unavailable" }
    });

    expect(run.attempted).toBe(2);
    expect(run.synced).toBe(1);
    expect(run.failed).toBe(1);
    expect(run.items.find((item) => item.id === accepted.id)).toEqual(
      expect.objectContaining({ status: "synced", receipt_id: "receipt_ok", attempts: 1 })
    );
    expect(run.items.find((item) => item.id === rejected.id)).toEqual(
      expect.objectContaining({ status: "failed", last_error: "API unavailable", attempts: 1 })
    );
  });
});
