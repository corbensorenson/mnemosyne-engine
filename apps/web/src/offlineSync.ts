import type { OfflineQueueItem, OfflineSyncTransport } from "@mnemosyne/offline-core";
import { createId } from "@mnemosyne/shared-utils";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
};

type OfflineReceipt = {
  receipt_id: string;
};

type OfflineSyncRequest = {
  url: string;
  body: Record<string, unknown>;
  directDomainWrite: boolean;
};

export function createBrowserOfflineSyncTransport(): OfflineSyncTransport {
  const apiBaseUrl = String(import.meta.env.VITE_MNEMOSYNE_API_URL ?? "").replace(/\/$/, "");
  if (!apiBaseUrl) {
    return async (item) => ({
      ok: true,
      statusCode: 202,
      receiptId: createId("offline_dry_run_receipt", item.id)
    });
  }
  return async (item) => postOfflineItem(apiBaseUrl, item);
}

async function postOfflineItem(apiBaseUrl: string, item: OfflineQueueItem) {
  const request = offlineSyncRequestForItem(apiBaseUrl, item);
  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": localCsrfToken(),
      "X-Idempotency-Key": item.idempotency_key,
      "X-Mnemosyne-Offline-Action": item.action_type
    },
    body: JSON.stringify(request.body)
  });
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<OfflineReceipt> & {
    audit_event_id?: string;
    data?: Record<string, unknown>;
  };
  if (!response.ok || !envelope.ok || !envelope.data) {
    return {
      ok: false,
      statusCode: response.status,
      error: envelope.error?.message ?? `Offline sync failed with HTTP ${response.status}.`
    };
  }
  return {
    ok: true,
    statusCode: response.status,
    receiptId: request.directDomainWrite ? domainReceiptId(item, envelope) : envelope.data.receipt_id
  };
}

export function offlineSyncRequestForItem(apiBaseUrl: string, item: OfflineQueueItem): OfflineSyncRequest {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  if (isDomainWritableOfflineActionItem(item)) {
    return {
      url: `${baseUrl}${item.endpoint}`,
      body: item.payload,
      directDomainWrite: true
    };
  }
  return {
    url: `${baseUrl}/api/offline/actions/sync`,
    body: { item },
    directDomainWrite: false
  };
}

function isDomainWritableOfflineActionItem(item: OfflineQueueItem): boolean {
  const hasAssessmentResponses = Array.isArray(item.payload.responses) && item.payload.responses.length > 0;
  const isMorningForge =
    item.action_type === "morning_forge_response" &&
    item.method === "POST" &&
    item.endpoint === "/api/morning-forge/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.dailyPacketId === "string" &&
    hasAssessmentResponses;
  const isWalkMode =
    item.action_type === "walk_mode_completion" &&
    item.method === "POST" &&
    item.endpoint === "/api/walk-mode/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.dailyPacketId === "string" &&
    typeof item.payload.walkPacketId === "string" &&
    hasAssessmentResponses;
  const isEveningLockIn =
    item.action_type === "evening_lock_in_completion" &&
    item.method === "POST" &&
    item.endpoint === "/api/evening-lock-in/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.dailyPacketId === "string" &&
    Array.isArray(item.payload.recallResponses) &&
    Array.isArray(item.payload.transferResponses) &&
    Array.isArray(item.payload.boundCueIds) &&
    typeof item.payload.phoneDownChecklist === "object" &&
    item.payload.phoneDownChecklist !== null;
  const isGraphFeed =
    item.action_type === "graphfeed_recall" &&
    item.method === "POST" &&
    /^\/api\/watch-packets\/[^/]+\/complete$/.test(item.endpoint) &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.watchPacketId === "string" &&
    Array.isArray(item.payload.videoIds) &&
    item.payload.videoIds.length > 0 &&
    typeof item.payload.recallPassed === "boolean" &&
    typeof item.payload.screenMinutes === "number";
  const isSleepPlayback =
    item.action_type === "sleep_playback_event" &&
    item.method === "POST" &&
    item.endpoint === "/api/sleep/playback/events" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.sleepPacketId === "string" &&
    Array.isArray(item.payload.cueEvents) &&
    item.payload.cueEvents.length > 0 &&
    typeof item.payload.stopCondition === "string" &&
    typeof item.payload.sleepDisruptionReported === "boolean";
  const isSleepRecall =
    item.action_type === "sleep_recall_completion" &&
    item.method === "POST" &&
    item.endpoint === "/api/sleep/recall/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.sleepPacketId === "string" &&
    Array.isArray(item.payload.cuedResponses) &&
    item.payload.cuedResponses.length > 0 &&
    Array.isArray(item.payload.controlResponses) &&
    item.payload.controlResponses.length > 0 &&
    typeof item.payload.screenMinutes === "number" &&
    typeof item.payload.voiceUsed === "boolean";
  return isMorningForge || isWalkMode || isEveningLockIn || isGraphFeed || isSleepPlayback || isSleepRecall;
}

function domainReceiptId(
  item: OfflineQueueItem,
  envelope: ApiEnvelope<OfflineReceipt> & { audit_event_id?: string; data?: Record<string, unknown> }
): string {
  const session = envelope.data?.session;
  const sessionId =
    session && typeof session === "object" && "id" in session && typeof session.id === "string"
      ? session.id
      : undefined;
  return envelope.audit_event_id ?? sessionId ?? createId("domain_sync_receipt", item.id);
}

function localCsrfToken(): string {
  try {
    return window.localStorage.getItem("mnemosyne.csrfToken") ?? "pwa-offline-sync";
  } catch {
    return "pwa-offline-sync";
  }
}
