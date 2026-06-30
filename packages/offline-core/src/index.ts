import { createId, nowIso, round, stableHash } from "@mnemosyne/shared-utils";

export const offlineActionTypes = [
  "daily_packet_cache",
  "morning_forge_response",
  "graphfeed_recall",
  "paced_read_completion",
  "walk_mode_completion",
  "evening_lock_in_completion",
  "sleep_playback_event",
  "sleep_recall_completion",
  "wearable_sleep_sync",
  "privacy_operation",
  "incident_report"
] as const;

export type OfflineActionType = (typeof offlineActionTypes)[number];
export type OfflineHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type OfflineQueueStatus = "queued" | "syncing" | "synced" | "failed" | "discarded";
export type OfflinePayloadScope = "learning" | "voice" | "sleep" | "health" | "privacy" | "ops";

export type OfflineQueueItem = {
  schema_version: "mnemosyne-offline-queue-item-v0.1";
  id: string;
  user_id: string;
  action_type: OfflineActionType;
  endpoint: string;
  method: OfflineHttpMethod;
  payload: Record<string, unknown>;
  payload_scope: OfflinePayloadScope;
  payload_sha: string;
  status: OfflineQueueStatus;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  locked_at?: string;
  locked_by?: string;
  synced_at?: string;
  receipt_id?: string;
  http_status?: number;
  last_error?: string;
};

export type OfflineQueueSummary = {
  generated_at: string;
  total: number;
  queued: number;
  syncing: number;
  synced: number;
  failed: number;
  discarded: number;
  retryable: number;
  stale_syncing_item_ids: string[];
  unsafe_payload_item_ids: string[];
  action_counts: Record<OfflineActionType, number>;
  coverage: OfflineActionType[];
  oldest_queued_at?: string;
  ready_for_sync: boolean;
};

export type OfflineReleaseGate = {
  schema_version: "mnemosyne-offline-release-gate-v0.1";
  generated_at: string;
  passed: boolean;
  score: number;
  required_actions: OfflineActionType[];
  missing_actions: OfflineActionType[];
  checks: {
    service_worker_registered: boolean;
    manifest_present: boolean;
    indexeddb_available: boolean;
    required_actions_covered: boolean;
    idempotency_keys_present: boolean;
    privacy_safe_payloads: boolean;
    no_stale_syncing_items: boolean;
    retry_budget_available: boolean;
    sync_recovery_checked: boolean;
  };
  summary: OfflineQueueSummary;
  remediation: string[];
};

export type OfflineSyncTransportResult = {
  ok: boolean;
  statusCode: number;
  receiptId?: string;
  error?: string;
};

export type OfflineSyncTransport = (item: OfflineQueueItem) => Promise<OfflineSyncTransportResult>;

export type OfflineSyncRunResult = {
  generated_at: string;
  attempted: number;
  synced: number;
  failed: number;
  skipped: number;
  items: OfflineQueueItem[];
};

export const defaultOfflineRequiredActions: OfflineActionType[] = [
  "daily_packet_cache",
  "morning_forge_response",
  "graphfeed_recall",
  "paced_read_completion",
  "walk_mode_completion",
  "evening_lock_in_completion",
  "sleep_playback_event",
  "sleep_recall_completion"
];

export function createOfflineQueueItem(input: {
  userId: string;
  actionType: OfflineActionType;
  endpoint: string;
  method: OfflineHttpMethod;
  payload: Record<string, unknown>;
  payloadScope?: OfflinePayloadScope;
  maxAttempts?: number;
  idempotencyKey?: string;
  createdAt?: string;
}): OfflineQueueItem {
  const createdAt = input.createdAt ?? nowIso();
  const payloadSha = payloadHash(input.payload);
  const idempotencyKey =
    input.idempotencyKey ??
    `${input.userId}:${input.actionType}:${input.method}:${input.endpoint}:${payloadSha}`;
  return {
    schema_version: "mnemosyne-offline-queue-item-v0.1",
    id: createId("offline", idempotencyKey),
    user_id: input.userId,
    action_type: input.actionType,
    endpoint: input.endpoint,
    method: input.method,
    payload: input.payload,
    payload_scope: input.payloadScope ?? "learning",
    payload_sha: payloadSha,
    status: "queued",
    attempts: 0,
    max_attempts: input.maxAttempts ?? 5,
    idempotency_key: idempotencyKey,
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function upsertOfflineItem(items: OfflineQueueItem[], item: OfflineQueueItem): OfflineQueueItem[] {
  const index = items.findIndex(
    (candidate) => candidate.id === item.id || candidate.idempotency_key === item.idempotency_key
  );
  if (index < 0) return [...items, item];
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

export function markOfflineItemSyncing(
  item: OfflineQueueItem,
  workerId: string,
  at = nowIso()
): OfflineQueueItem {
  if (item.status === "synced" || item.status === "discarded") return item;
  return {
    ...item,
    status: "syncing",
    attempts: item.attempts + 1,
    locked_at: at,
    locked_by: workerId,
    last_error: undefined,
    updated_at: at
  };
}

export function markOfflineItemSynced(
  item: OfflineQueueItem,
  input: {
    statusCode?: number;
    receiptId?: string;
    syncedAt?: string;
  } = {}
): OfflineQueueItem {
  const syncedAt = input.syncedAt ?? nowIso();
  return {
    ...item,
    status: "synced",
    locked_at: undefined,
    locked_by: undefined,
    synced_at: syncedAt,
    receipt_id: input.receiptId ?? createId("sync_receipt", item.id),
    http_status: input.statusCode ?? 200,
    updated_at: syncedAt
  };
}

export function markOfflineItemFailed(
  item: OfflineQueueItem,
  error: string,
  at = nowIso()
): OfflineQueueItem {
  return {
    ...item,
    status: "failed",
    locked_at: undefined,
    locked_by: undefined,
    last_error: error,
    updated_at: at
  };
}

export function recoverStaleOfflineItems(
  items: OfflineQueueItem[],
  input: {
    at?: string;
    staleAfterMinutes?: number;
  } = {}
): OfflineQueueItem[] {
  const at = input.at ?? nowIso();
  const staleAfterMinutes = input.staleAfterMinutes ?? 15;
  return items.map((item) => {
    if (!isStaleSyncingItem(item, at, staleAfterMinutes)) return item;
    if (item.attempts >= item.max_attempts) {
      return markOfflineItemFailed(item, "Offline sync lock expired after retry budget was exhausted.", at);
    }
    return {
      ...item,
      status: "queued",
      locked_at: undefined,
      locked_by: undefined,
      last_error: "Recovered stale offline sync lock.",
      updated_at: at
    };
  });
}

export async function syncOfflineQueueItems(input: {
  items: OfflineQueueItem[];
  transport: OfflineSyncTransport;
  workerId?: string;
  at?: string;
  limit?: number;
}): Promise<OfflineSyncRunResult> {
  const generatedAt = input.at ?? nowIso();
  const workerId = input.workerId ?? "offline-sync";
  const limit = input.limit ?? Number.POSITIVE_INFINITY;
  let attempted = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const next: OfflineQueueItem[] = [];

  for (const item of input.items) {
    if (attempted >= limit || !isRetryableOfflineItem(item)) {
      skipped += item.status === "queued" || item.status === "failed" ? 1 : 0;
      next.push(item);
      continue;
    }
    attempted += 1;
    const syncing = markOfflineItemSyncing(item, workerId, generatedAt);
    try {
      const receipt = await input.transport(syncing);
      if (receipt.ok) {
        synced += 1;
        next.push(
          markOfflineItemSynced(syncing, {
            statusCode: receipt.statusCode,
            receiptId: receipt.receiptId,
            syncedAt: generatedAt
          })
        );
      } else {
        failed += 1;
        next.push(markOfflineItemFailed(syncing, receipt.error ?? `HTTP ${receipt.statusCode}`, generatedAt));
      }
    } catch (error) {
      failed += 1;
      next.push(markOfflineItemFailed(syncing, errorMessage(error), generatedAt));
    }
  }

  return {
    generated_at: generatedAt,
    attempted,
    synced,
    failed,
    skipped,
    items: next
  };
}

export function summarizeOfflineQueue(
  items: OfflineQueueItem[],
  input: {
    generatedAt?: string;
    staleAfterMinutes?: number;
  } = {}
): OfflineQueueSummary {
  const generatedAt = input.generatedAt ?? nowIso();
  const staleAfterMinutes = input.staleAfterMinutes ?? 15;
  const actionCounts = Object.fromEntries(
    offlineActionTypes.map((actionType) => [
      actionType,
      items.filter((item) => item.action_type === actionType).length
    ])
  ) as Record<OfflineActionType, number>;
  const staleSyncingItemIds = items
    .filter((item) => isStaleSyncingItem(item, generatedAt, staleAfterMinutes))
    .map((item) => item.id);
  const unsafePayloadItemIds = items
    .filter((item) => !offlinePayloadSafe(item.payload))
    .map((item) => item.id);
  const queuedItems = items.filter((item) => item.status === "queued" || item.status === "failed");
  return {
    generated_at: generatedAt,
    total: items.length,
    queued: countStatus(items, "queued"),
    syncing: countStatus(items, "syncing"),
    synced: countStatus(items, "synced"),
    failed: countStatus(items, "failed"),
    discarded: countStatus(items, "discarded"),
    retryable: queuedItems.filter((item) => item.attempts < item.max_attempts).length,
    stale_syncing_item_ids: staleSyncingItemIds,
    unsafe_payload_item_ids: unsafePayloadItemIds,
    action_counts: actionCounts,
    coverage: offlineActionTypes.filter((actionType) => actionCounts[actionType] > 0),
    oldest_queued_at: oldestIso(queuedItems.map((item) => item.created_at)),
    ready_for_sync: queuedItems.some((item) => item.attempts < item.max_attempts)
  };
}

export function buildOfflineReleaseGate(input: {
  items: OfflineQueueItem[];
  serviceWorkerRegistered: boolean;
  manifestPresent: boolean;
  indexedDbAvailable: boolean;
  syncRecoveryChecked: boolean;
  requiredActions?: OfflineActionType[];
  generatedAt?: string;
}): OfflineReleaseGate {
  const generatedAt = input.generatedAt ?? nowIso();
  const requiredActions = input.requiredActions ?? defaultOfflineRequiredActions;
  const summary = summarizeOfflineQueue(input.items, { generatedAt });
  const missingActions = requiredActions.filter((actionType) => summary.action_counts[actionType] === 0);
  const checks = {
    service_worker_registered: input.serviceWorkerRegistered,
    manifest_present: input.manifestPresent,
    indexeddb_available: input.indexedDbAvailable,
    required_actions_covered: missingActions.length === 0,
    idempotency_keys_present: input.items.every((item) => item.idempotency_key.length > 0),
    privacy_safe_payloads: summary.unsafe_payload_item_ids.length === 0,
    no_stale_syncing_items: summary.stale_syncing_item_ids.length === 0,
    retry_budget_available: input.items.every(
      (item) => item.status === "synced" || item.status === "discarded" || item.attempts < item.max_attempts
    ),
    sync_recovery_checked: input.syncRecoveryChecked
  };
  const values = Object.values(checks);
  const score = round(values.filter(Boolean).length / values.length, 4);
  return {
    schema_version: "mnemosyne-offline-release-gate-v0.1",
    generated_at: generatedAt,
    passed: values.every(Boolean),
    score,
    required_actions: requiredActions,
    missing_actions: missingActions,
    checks,
    summary,
    remediation: offlineRemediation(checks, missingActions, summary)
  };
}

function isRetryableOfflineItem(item: OfflineQueueItem): boolean {
  return (item.status === "queued" || item.status === "failed") && item.attempts < item.max_attempts;
}

function isStaleSyncingItem(item: OfflineQueueItem, at: string, staleAfterMinutes: number): boolean {
  if (item.status !== "syncing") return false;
  const lockedAt = Date.parse(item.locked_at ?? item.updated_at);
  return Number.isFinite(lockedAt) && lockedAt < Date.parse(at) - staleAfterMinutes * 60_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function offlinePayloadSafe(payload: Record<string, unknown>): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload).toLowerCase();
  } catch {
    return false;
  }
  return !/(session_token|csrf_token|access_token|refresh_token|password|secret|private_key)/.test(
    serialized
  );
}

function offlineRemediation(
  checks: OfflineReleaseGate["checks"],
  missingActions: OfflineActionType[],
  summary: OfflineQueueSummary
): string[] {
  const actions: string[] = [];
  if (!checks.service_worker_registered) actions.push("Register the PWA service worker before release.");
  if (!checks.manifest_present) actions.push("Ship a web manifest with install metadata.");
  if (!checks.indexeddb_available) actions.push("Enable IndexedDB-backed offline action storage.");
  if (!checks.required_actions_covered) {
    actions.push(`Queue representative offline actions for ${missingActions.join(", ")}.`);
  }
  if (!checks.idempotency_keys_present) actions.push("Attach stable idempotency keys to every offline item.");
  if (!checks.privacy_safe_payloads) {
    actions.push(`Remove secrets from offline payloads ${summary.unsafe_payload_item_ids.join(", ")}.`);
  }
  if (!checks.no_stale_syncing_items) {
    actions.push(`Recover stale syncing items ${summary.stale_syncing_item_ids.join(", ")}.`);
  }
  if (!checks.retry_budget_available)
    actions.push("Discard or manually inspect items that exhausted retry budget.");
  if (!checks.sync_recovery_checked) actions.push("Run the offline stale-lock recovery drill.");
  return actions;
}

function payloadHash(payload: Record<string, unknown>): string {
  return stableHash(stableJson(payload)).toString(16).padStart(8, "0");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function countStatus(items: OfflineQueueItem[], status: OfflineQueueStatus): number {
  return items.filter((item) => item.status === status).length;
}

function oldestIso(values: string[]): string | undefined {
  return values.filter(Boolean).sort()[0];
}
