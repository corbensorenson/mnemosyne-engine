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
  method: "POST" | "DELETE";
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
    method: request.method,
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
      method: item.method === "DELETE" ? "DELETE" : "POST",
      body: item.payload,
      directDomainWrite: true
    };
  }
  return {
    url: `${baseUrl}/api/offline/actions/sync`,
    method: "POST",
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
  const isTutorTurn =
    item.action_type === "tutor_turn" &&
    item.method === "POST" &&
    item.endpoint === "/api/tutor/turn" &&
    typeof item.payload.userId === "string" &&
    isTutorMode(item.payload.mode) &&
    typeof item.payload.item === "object" &&
    item.payload.item !== null &&
    typeof item.payload.rawResponse === "string" &&
    typeof item.payload.latencyMs === "number" &&
    isAnswerEntryMode(item.payload.entryMode) &&
    isTranscriptRetention(item.payload.transcriptRetention);
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
  const isPacedRead =
    item.action_type === "paced_read_completion" &&
    item.method === "POST" &&
    item.endpoint === "/api/paced-read/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.pacedReadSessionId === "string" &&
    typeof item.payload.assetId === "string" &&
    typeof item.payload.rawWpm === "number" &&
    typeof item.payload.comprehensionScore === "number" &&
    typeof item.payload.retentionScore === "number" &&
    typeof item.payload.strainRating === "number" &&
    typeof item.payload.screenMinutes === "number";
  const isSpeedListen =
    item.action_type === "speed_listen_completion" &&
    item.method === "POST" &&
    item.endpoint === "/api/speed-listen/complete" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.speedListenSessionId === "string" &&
    typeof item.payload.sourceId === "string" &&
    typeof item.payload.sourceKind === "string" &&
    typeof item.payload.rawListenWpm === "number" &&
    typeof item.payload.playbackRate === "number" &&
    typeof item.payload.comprehensionScore === "number" &&
    typeof item.payload.retentionScore === "number" &&
    typeof item.payload.strainRating === "number" &&
    typeof item.payload.distractionRating === "number" &&
    typeof item.payload.audioMinutes === "number";
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
  const isWearableSleepSync =
    item.action_type === "wearable_sleep_sync" &&
    item.method === "POST" &&
    item.endpoint === "/api/wearables/sync" &&
    typeof item.payload.userId === "string" &&
    typeof item.payload.provider === "string" &&
    typeof item.payload.sleepSession === "object" &&
    item.payload.sleepSession !== null;
  const isIncidentReport =
    item.action_type === "incident_report" &&
    item.method === "POST" &&
    item.endpoint === "/api/ops/incidents/reports" &&
    typeof item.payload.operatorId === "string" &&
    isOpsEnvironment(item.payload.environment) &&
    (typeof item.payload.title === "string" || item.payload.title === undefined);
  const isPrivacyExportJob =
    item.action_type === "privacy_operation" &&
    item.method === "POST" &&
    item.endpoint === "/api/privacy/export/jobs" &&
    typeof item.payload.userId === "string" &&
    (typeof item.payload.idempotencyKey === "string" || item.payload.idempotencyKey === undefined);
  const isPrivacyDeletion =
    item.action_type === "privacy_operation" &&
    item.method === "DELETE" &&
    item.endpoint === "/api/privacy/data" &&
    typeof item.payload.userId === "string" &&
    isPrivacyDeletionScope(item.payload.scope) &&
    item.payload.confirmation === "DELETE";
  return (
    isMorningForge ||
    isTutorTurn ||
    isWalkMode ||
    isEveningLockIn ||
    isGraphFeed ||
    isPacedRead ||
    isSpeedListen ||
    isSleepPlayback ||
    isSleepRecall ||
    isWearableSleepSync ||
    isIncidentReport ||
    isPrivacyExportJob ||
    isPrivacyDeletion
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

function isOpsEnvironment(value: unknown): value is "local" | "staging" | "production" {
  return value === "local" || value === "staging" || value === "production";
}

function isPrivacyDeletionScope(value: unknown): value is "account" | "health" | "sleep" | "voice" {
  return value === "account" || value === "health" || value === "sleep" || value === "voice";
}

function isTutorMode(value: unknown): boolean {
  return (
    value === "socratic" ||
    value === "examiner" ||
    value === "calm_coach" ||
    value === "debate_opponent" ||
    value === "language_partner" ||
    value === "debugger" ||
    value === "oral_board" ||
    value === "walk_coach" ||
    value === "sleep_prep_guide"
  );
}

function isAnswerEntryMode(value: unknown): value is "text" | "voice" {
  return value === "text" || value === "voice";
}

function isTranscriptRetention(value: unknown): boolean {
  return value === "deleted" || value === "transcript_only" || value === "retained";
}

function localCsrfToken(): string {
  try {
    return window.localStorage.getItem("mnemosyne.csrfToken") ?? "pwa-offline-sync";
  } catch {
    return "pwa-offline-sync";
  }
}
