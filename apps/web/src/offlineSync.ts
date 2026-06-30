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
  if (isDomainWritableMorningForgeItem(item)) {
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

function isDomainWritableMorningForgeItem(item: OfflineQueueItem): boolean {
  return (
    item.action_type === "morning_forge_response" &&
    item.method === "POST" &&
    item.endpoint === "/api/morning-forge/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.dailyPacketId === "string" &&
    Array.isArray(item.payload.responses) &&
    item.payload.responses.length > 0
  );
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
