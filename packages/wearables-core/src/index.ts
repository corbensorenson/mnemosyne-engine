import type { DeviceCapabilityProfile, ReadinessProfile } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round, stableHash } from "@mnemosyne/shared-utils";

export type WearableProvider = "oura" | "healthkit" | "health_connect" | "manual";
export type WearableConnectionStatus = "authorization_required" | "connected" | "revoked" | "fallback";

export type WearableTokenEnvelope = {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  salt: string;
  key_hint: string;
  created_at: string;
};

export type WearableConnection = {
  id: string;
  user_id: string;
  provider: WearableProvider;
  status: WearableConnectionStatus;
  scopes: string[];
  token_envelope?: WearableTokenEnvelope;
  refresh_token_envelope?: WearableTokenEnvelope;
  authorization_url?: string;
  state?: string;
  created_at: string;
  updated_at: string;
  revoked_at?: string;
};

export type RawWearableSleepStage = {
  stage?: string;
  type?: string;
  started_at?: string;
  ended_at?: string;
  duration_minutes?: number;
  duration_min?: number;
  duration_seconds?: number;
  seconds?: number;
};

export type RawWearableSleepSession = {
  provider?: WearableProvider;
  external_id?: string;
  sleep_quality?: number;
  fatigue?: number;
  started_at?: string;
  ended_at?: string;
  readiness_score?: number;
  sleep_score?: number;
  efficiency?: number;
  stages?: RawWearableSleepStage[];
};

export type NormalizedSleepStage = {
  stage: "awake" | "light" | "deep" | "rem" | "unknown";
  started_at?: string;
  ended_at?: string;
  duration_minutes: number;
};

export type NormalizedWearableSleepSession = {
  id: string;
  user_id: string;
  provider: WearableProvider;
  external_id?: string;
  started_at?: string;
  ended_at?: string;
  sleep_quality: number;
  fatigue: number;
  readiness_delta: number;
  stages: NormalizedSleepStage[];
  stage_minutes: Record<NormalizedSleepStage["stage"], number>;
  source_summary: string[];
  created_at: string;
};

export type OuraAuthorizationRequest = {
  provider: "oura";
  authorization_url: string;
  state: string;
  scopes: string[];
};

export type NativeEdgePlan = {
  platform: "ios" | "android" | "desktop" | "unknown";
  healthkit: "available" | "planned_native_companion" | "unavailable";
  health_connect: "available" | "planned_native_companion" | "unavailable";
  background_audio: "web_supported" | "native_companion_recommended" | "unavailable";
  local_notifications: "web_push" | "native_companion_recommended" | "unavailable";
  watch_haptics: "native_companion_required" | "unavailable";
  notes: string[];
};

export type WearableCapabilityDashboard = {
  user_id: string;
  device: DeviceCapabilityProfile;
  connections: WearableConnection[];
  provider_status: Record<WearableProvider, WearableConnectionStatus>;
  latest_sleep?: NormalizedWearableSleepSession;
  readiness_adjustment?: Pick<ReadinessProfile, "sleep_quality" | "fatigue" | "notes">;
  native_edge_plan: NativeEdgePlan;
  fallback_available: boolean;
  generated_at: string;
};

const ouraAuthorizeUrl = "https://cloud.ouraring.com/oauth/authorize";
const ouraTokenUrl = "https://api.ouraring.com/oauth/token";
const ouraRevokeUrl = "https://api.ouraring.com/oauth/revoke";

export function buildOuraAuthorizationRequest(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
}): OuraAuthorizationRequest {
  const scopes = input.scopes?.length ? input.scopes : ["daily"];
  const state = input.state ?? createId("oura_state", `${input.userId}:${input.redirectUri}`);
  const url = new URL(ouraAuthorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return { provider: "oura", authorization_url: url.toString(), state, scopes };
}

export function buildOuraTokenExchangeRequest(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  return {
    url: ouraTokenUrl,
    method: "POST" as const,
    body: {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri
    }
  };
}

export async function createWearableConnection(input: {
  userId: string;
  provider: WearableProvider;
  scopes?: string[];
  accessToken?: string;
  refreshToken?: string;
  authorization?: OuraAuthorizationRequest;
  encryptionSecret?: string;
  createdAt?: string;
}): Promise<WearableConnection> {
  const createdAt = input.createdAt ?? nowIso();
  const base = {
    id: createId("wearable_connection", `${input.userId}:${input.provider}`),
    user_id: input.userId,
    provider: input.provider,
    scopes: input.scopes ?? input.authorization?.scopes ?? [],
    authorization_url: input.authorization?.authorization_url,
    state: input.authorization?.state,
    created_at: createdAt,
    updated_at: createdAt
  };
  if (!input.accessToken) {
    return { ...base, status: "authorization_required" };
  }
  return {
    ...base,
    status: "connected",
    token_envelope: await encryptWearableToken({
      userId: input.userId,
      provider: input.provider,
      token: input.accessToken,
      secret: input.encryptionSecret
    }),
    refresh_token_envelope: input.refreshToken
      ? await encryptWearableToken({
          userId: input.userId,
          provider: input.provider,
          token: input.refreshToken,
          secret: input.encryptionSecret,
          purpose: "refresh"
        })
      : undefined
  };
}

export function revokeWearableConnection(
  connection: WearableConnection,
  revokedAt = nowIso()
): WearableConnection {
  return {
    ...connection,
    status: "revoked",
    token_envelope: undefined,
    refresh_token_envelope: undefined,
    updated_at: revokedAt,
    revoked_at: revokedAt
  };
}

export function providerRevokeEndpoint(provider: WearableProvider): string | undefined {
  return provider === "oura" ? ouraRevokeUrl : undefined;
}

export async function encryptWearableToken(input: {
  userId: string;
  provider: WearableProvider;
  token: string;
  secret?: string;
  purpose?: "access" | "refresh";
  createdAt?: string;
}): Promise<WearableTokenEnvelope> {
  const createdAt = input.createdAt ?? nowIso();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(tokenSecret(input.userId, input.secret), salt);
  const encoded = new TextEncoder().encode(input.token);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(encoded)
  );
  return {
    algorithm: "AES-GCM",
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    key_hint: `${input.provider}:${input.purpose ?? "access"}:${stableHash(input.userId).toString(36)}`,
    created_at: createdAt
  };
}

export async function decryptWearableToken(input: {
  userId: string;
  envelope: WearableTokenEnvelope;
  secret?: string;
}): Promise<string> {
  const salt = base64ToBytes(input.envelope.salt);
  const iv = base64ToBytes(input.envelope.iv);
  const key = await deriveAesKey(tokenSecret(input.userId, input.secret), salt);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(base64ToBytes(input.envelope.ciphertext))
  );
  return new TextDecoder().decode(plaintext);
}

export function normalizeWearableSleepSession(input: {
  userId: string;
  provider: WearableProvider;
  raw: RawWearableSleepSession;
  createdAt?: string;
}): NormalizedWearableSleepSession {
  const stages = (input.raw.stages ?? []).map(normalizeStage);
  const stageMinutes = stageTotals(stages);
  const inferredQuality = qualityFromStages(stageMinutes, input.raw);
  const sleepQuality = clamp(input.raw.sleep_quality ?? input.raw.sleep_score ?? inferredQuality);
  const fatigue = clamp(input.raw.fatigue ?? 1 - sleepQuality * 0.78);
  const createdAt = input.createdAt ?? nowIso();
  return {
    id: createId("wearable_sleep", `${input.userId}:${input.provider}:${input.raw.external_id ?? createdAt}`),
    user_id: input.userId,
    provider: input.provider,
    external_id: input.raw.external_id,
    started_at: input.raw.started_at,
    ended_at: input.raw.ended_at,
    sleep_quality: round(sleepQuality, 3),
    fatigue: round(fatigue, 3),
    readiness_delta: round((sleepQuality - 0.5) * 0.28 - fatigue * 0.08, 3),
    stages,
    stage_minutes: stageMinutes,
    source_summary: [
      `${input.provider} sleep quality ${round(sleepQuality * 100)}%`,
      `${round(stageMinutes.deep)}m deep`,
      `${round(stageMinutes.rem)}m REM`,
      `${round(stageMinutes.awake)}m awake`
    ],
    created_at: createdAt
  };
}

export function readinessFromWearableSleep(
  session: NormalizedWearableSleepSession,
  current: ReadinessProfile
): ReadinessProfile {
  return {
    ...current,
    sleep_quality: session.sleep_quality,
    fatigue: session.fatigue,
    notes: `Synced from ${session.provider}: ${session.source_summary.join("; ")}`
  };
}

export function buildWearableCapabilityDashboard(input: {
  userId: string;
  device: DeviceCapabilityProfile;
  connections?: WearableConnection[];
  latestSleep?: NormalizedWearableSleepSession;
  readiness?: ReadinessProfile;
  generatedAt?: string;
}): WearableCapabilityDashboard {
  const connections = input.connections ?? [];
  return {
    user_id: input.userId,
    device: input.device,
    connections,
    provider_status: {
      oura: statusForProvider("oura", connections, input.device.oura_connected),
      healthkit: input.device.healthkit_available ? "fallback" : statusForProvider("healthkit", connections),
      health_connect: input.device.health_connect_available
        ? "fallback"
        : statusForProvider("health_connect", connections),
      manual: statusForProvider("manual", connections) === "revoked" ? "revoked" : "fallback"
    },
    latest_sleep: input.latestSleep,
    readiness_adjustment: input.readiness
      ? {
          sleep_quality: input.readiness.sleep_quality,
          fatigue: input.readiness.fatigue,
          notes: input.readiness.notes
        }
      : undefined,
    native_edge_plan: nativeEdgePlanFor(input.device),
    fallback_available: true,
    generated_at: input.generatedAt ?? nowIso()
  };
}

export function nativeEdgePlanFor(device: DeviceCapabilityProfile): NativeEdgePlan {
  return {
    platform: device.platform,
    healthkit: device.healthkit_available
      ? "available"
      : device.platform === "ios"
        ? "planned_native_companion"
        : "unavailable",
    health_connect: device.health_connect_available
      ? "available"
      : device.platform === "android"
        ? "planned_native_companion"
        : "unavailable",
    background_audio: device.background_audio_supported ? "web_supported" : "native_companion_recommended",
    local_notifications: device.web_push_supported ? "web_push" : "native_companion_recommended",
    watch_haptics:
      device.platform === "ios" || device.platform === "android"
        ? "native_companion_required"
        : "unavailable",
    notes: [
      "PWA owns consent, cue safety, and manual fallback.",
      "Native companion should only bridge OS health stores, background audio, local notifications, and watch haptics.",
      "Sleep-stage imports normalize before influencing Night Reactivation."
    ]
  };
}

function statusForProvider(
  provider: WearableProvider,
  connections: WearableConnection[],
  deviceConnected = false
): WearableConnectionStatus {
  const connection = [...connections].reverse().find((candidate) => candidate.provider === provider);
  if (connection) return connection.status;
  return deviceConnected ? "connected" : "fallback";
}

function normalizeStage(stage: RawWearableSleepStage): NormalizedSleepStage {
  return {
    stage: normalizeStageName(stage.stage ?? stage.type),
    started_at: stage.started_at,
    ended_at: stage.ended_at,
    duration_minutes: round(
      stage.duration_minutes ??
        stage.duration_min ??
        (stage.duration_seconds ?? stage.seconds ?? durationSeconds(stage.started_at, stage.ended_at)) / 60,
      2
    )
  };
}

function normalizeStageName(value: string | undefined): NormalizedSleepStage["stage"] {
  const normalized = value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (["wake", "awake", "restless"].includes(normalized)) return "awake";
  if (["light", "nrem1", "nrem2", "core"].includes(normalized)) return "light";
  if (["deep", "slowwave", "nrem3", "sws"].includes(normalized)) return "deep";
  if (["rem", "rapideyemovement"].includes(normalized)) return "rem";
  return "unknown";
}

function stageTotals(stages: NormalizedSleepStage[]): Record<NormalizedSleepStage["stage"], number> {
  return stages.reduce(
    (totals, stage) => ({
      ...totals,
      [stage.stage]: round(totals[stage.stage] + stage.duration_minutes, 2)
    }),
    { awake: 0, light: 0, deep: 0, rem: 0, unknown: 0 }
  );
}

function qualityFromStages(
  totals: Record<NormalizedSleepStage["stage"], number>,
  raw: RawWearableSleepSession
): number {
  const asleep = totals.light + totals.deep + totals.rem;
  const total = asleep + totals.awake + totals.unknown;
  const efficiency = raw.efficiency ?? (total > 0 ? asleep / total : 0.65);
  const deepRatio = asleep > 0 ? totals.deep / asleep : 0.12;
  const remRatio = asleep > 0 ? totals.rem / asleep : 0.18;
  return clamp(efficiency * 0.52 + deepRatio * 0.22 + remRatio * 0.18 + (raw.readiness_score ?? 0.6) * 0.08);
}

function durationSeconds(startedAt: string | undefined, endedAt: string | undefined): number {
  if (!startedAt || !endedAt) return 0;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
  return (ended - started) / 1000;
}

async function deriveAesKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function tokenSecret(userId: string, secret: string | undefined): string {
  return secret ?? `mnemosyne-local-wearable-secret:${userId}`;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
