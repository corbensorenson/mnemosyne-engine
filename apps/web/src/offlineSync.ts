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
  const response = await fetch(`${apiBaseUrl}/api/offline/actions/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": localCsrfToken(),
      "X-Idempotency-Key": item.idempotency_key,
      "X-Mnemosyne-Offline-Action": item.action_type
    },
    body: JSON.stringify({ item })
  });
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<OfflineReceipt>;
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
    receiptId: envelope.data.receipt_id
  };
}

function localCsrfToken(): string {
  try {
    return window.localStorage.getItem("mnemosyne.csrfToken") ?? "pwa-offline-sync";
  } catch {
    return "pwa-offline-sync";
  }
}
