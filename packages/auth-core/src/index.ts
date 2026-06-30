import type { User } from "@mnemosyne/schema";
import { createId, minutesFromNow, nowIso, stableHash } from "@mnemosyne/shared-utils";

export type AuthProvider = "passkey" | "oauth" | "dev";
export type AuthRole = "learner" | "creator" | "moderator" | "admin" | "researcher" | "service";
export type AuthAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "sync"
  | "score"
  | "assign"
  | "moderate"
  | "release"
  | "operate";

export type AuthResourceKind =
  | "user_profile"
  | "goal"
  | "personal_graph"
  | "daily_packet"
  | "session"
  | "assessment_response"
  | "sleep_data"
  | "health_data"
  | "voice_data"
  | "privacy_export"
  | "privacy_delete"
  | "master_graph"
  | "proposal"
  | "creator_submission"
  | "social_challenge"
  | "experiment"
  | "analytics"
  | "admin_ops"
  | "service_job";

export type ResourceVisibility = "private" | "badges_only" | "friends" | "public" | "aggregate" | "internal";

export type AuthSession = {
  id: string;
  user_id: string;
  roles: AuthRole[];
  provider: AuthProvider;
  issued_at: string;
  expires_at: string;
  session_token_hash: string;
  csrf_token_hash: string;
  device_binding_hash?: string;
  last_seen_at?: string;
};

export type AuthResource = {
  kind: AuthResourceKind;
  object_id?: string;
  owner_id?: string;
  visibility?: ResourceVisibility;
  consent_required?: "product_analytics" | "research";
  risk_level?: "low" | "medium" | "high";
};

export type SessionIssueResult = {
  session: AuthSession;
  session_token: string;
  csrf_token: string;
};

export type TokenVerificationResult = {
  session_active: boolean;
  session_token_valid: boolean;
  csrf_token_valid: boolean;
};

export type AuthorizationDecision = {
  allowed: boolean;
  reason: string;
  required_roles: AuthRole[];
  audit_action: "allow" | "deny";
};

export type SecurityPosture = {
  user_id: string;
  session_active: boolean;
  roles: AuthRole[];
  provider: AuthProvider;
  csrf_required: boolean;
  private_default: boolean;
  product_analytics_allowed: boolean;
  research_allowed: boolean;
  allowed_surfaces: AuthResourceKind[];
  generated_at: string;
};

export async function issueAuthSession(input: {
  userId: string;
  provider: AuthProvider;
  roles?: AuthRole[];
  ttlMinutes?: number;
  issuedAt?: string;
  sessionSeed?: string;
  csrfSeed?: string;
  deviceBinding?: string;
}): Promise<SessionIssueResult> {
  const issuedAt = input.issuedAt ?? nowIso();
  const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? 480, 60 * 24 * 30));
  const roles = normalizeRoles(input.roles);
  const sessionToken = input.sessionSeed
    ? deterministicToken("session", `${input.userId}:${input.sessionSeed}`)
    : randomToken("session");
  const csrfToken = input.csrfSeed
    ? deterministicToken("csrf", `${input.userId}:${input.csrfSeed}`)
    : randomToken("csrf");
  return {
    session: {
      id: createId("auth_session", `${input.userId}:${issuedAt}:${sessionToken}`),
      user_id: input.userId,
      roles,
      provider: input.provider,
      issued_at: issuedAt,
      expires_at: minutesFromNow(ttlMinutes, new Date(issuedAt)),
      session_token_hash: await sha256Hex(sessionToken),
      csrf_token_hash: await sha256Hex(csrfToken),
      device_binding_hash: input.deviceBinding ? await sha256Hex(input.deviceBinding) : undefined,
      last_seen_at: issuedAt
    },
    session_token: sessionToken,
    csrf_token: csrfToken
  };
}

export async function verifyAuthTokens(input: {
  session: AuthSession;
  sessionToken: string;
  csrfToken?: string;
  now?: string;
}): Promise<TokenVerificationResult> {
  return {
    session_active: isSessionActive(input.session, input.now),
    session_token_valid: input.session.session_token_hash === (await sha256Hex(input.sessionToken)),
    csrf_token_valid: input.csrfToken
      ? input.session.csrf_token_hash === (await sha256Hex(input.csrfToken))
      : false
  };
}

export function isSessionActive(session: AuthSession, at = nowIso()): boolean {
  const checkedAt = Date.parse(at);
  const issuedAt = Date.parse(session.issued_at);
  const expiresAt = Date.parse(session.expires_at);
  return (
    Number.isFinite(checkedAt) &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= checkedAt &&
    checkedAt < expiresAt
  );
}

export function authorizeAction(input: {
  session: AuthSession;
  action: AuthAction;
  resource: AuthResource;
  user?: User;
  now?: string;
}): AuthorizationDecision {
  if (!isSessionActive(input.session, input.now)) {
    return deny("session expired", ["learner"]);
  }

  const roles = new Set(input.session.roles);
  const resource = normalizeResource(input.resource);
  const ownerMatch = resource.owner_id === input.session.user_id;
  const visibility = resource.visibility ?? (ownerMatch ? "private" : "internal");

  if (roles.has("admin")) return allow("admin role", ["admin"]);

  if (resource.consent_required && input.user && !consentAllows(input.user, resource.consent_required)) {
    return deny(`${resource.consent_required.replace("_", " ")} consent required`, ["researcher", "admin"]);
  }

  if (resource.kind === "admin_ops") return deny("admin operations require admin role", ["admin"]);

  if (
    roles.has("service") &&
    (resource.kind === "service_job" || ["operate", "sync", "assign"].includes(input.action))
  ) {
    return allow("service role", ["service"]);
  }

  if (ownerMatch && canOwnerAccess(input.action, resource.kind, roles)) {
    return allow("resource owner", ["learner"]);
  }

  if (visibility === "public" && input.action === "read") {
    return allow("public resource", ["learner"]);
  }

  if (
    visibility === "aggregate" &&
    resource.kind === "analytics" &&
    input.action === "read" &&
    roles.has("researcher")
  ) {
    return allow("aggregate analytics researcher", ["researcher"]);
  }

  if (canCreatorAccess(input.action, resource, roles, ownerMatch)) {
    return allow("creator permission", ["creator"]);
  }

  if (canModeratorAccess(input.action, resource.kind, roles)) {
    return allow("moderator permission", ["moderator"]);
  }

  return deny("object-level policy denied access", requiredRolesFor(input.action, resource.kind));
}

export function buildSecurityPosture(input: {
  session: AuthSession;
  user?: User;
  now?: string;
}): SecurityPosture {
  const roles = normalizeRoles(input.session.roles);
  return {
    user_id: input.session.user_id,
    session_active: isSessionActive(input.session, input.now),
    roles,
    provider: input.session.provider,
    csrf_required: true,
    private_default: input.user?.privacy_settings.private_default === false ? false : true,
    product_analytics_allowed: input.user?.privacy_settings.product_analytics_consent === true,
    research_allowed: input.user?.privacy_settings.research_consent === true,
    allowed_surfaces: allowedSurfacesFor(roles),
    generated_at: nowIso()
  };
}

export function consentAllows(user: User, purpose: "product_analytics" | "research"): boolean {
  return purpose === "product_analytics"
    ? user.privacy_settings.product_analytics_consent === true
    : user.privacy_settings.research_consent === true;
}

function normalizeRoles(roles: AuthRole[] | undefined): AuthRole[] {
  const fallback: AuthRole[] = ["learner"];
  const normalized = Array.from(new Set<AuthRole>(roles?.length ? roles : fallback));
  return normalized.includes("admin")
    ? ["admin", ...normalized.filter((role) => role !== "admin")]
    : normalized;
}

function normalizeResource(resource: AuthResource): AuthResource {
  if (resource.kind === "master_graph" || resource.kind === "proposal") {
    return { visibility: "public", ...resource };
  }
  return resource;
}

function canOwnerAccess(action: AuthAction, kind: AuthResourceKind, roles: Set<AuthRole>): boolean {
  if (!roles.has("learner") && !roles.has("creator")) return false;
  if (["privacy_export", "privacy_delete"].includes(kind)) return ["export", "delete"].includes(action);
  if (["health_data", "sleep_data", "voice_data"].includes(kind)) {
    return ["read", "update", "delete", "sync"].includes(action);
  }
  if (
    ["user_profile", "goal", "personal_graph", "daily_packet", "session", "assessment_response"].includes(
      kind
    )
  ) {
    return ["read", "create", "update", "delete", "score"].includes(action);
  }
  if (kind === "experiment") return ["read", "assign"].includes(action);
  if (kind === "social_challenge") return ["read", "create", "update", "delete"].includes(action);
  if (kind === "creator_submission")
    return roles.has("creator") && ["read", "create", "update", "delete"].includes(action);
  return false;
}

function canCreatorAccess(
  action: AuthAction,
  resource: AuthResource,
  roles: Set<AuthRole>,
  ownerMatch: boolean
): boolean {
  if (!roles.has("creator")) return false;
  if (resource.kind === "creator_submission") return ownerMatch || action === "create";
  if (resource.kind === "proposal") return ["read", "create", "update"].includes(action);
  if (resource.kind === "master_graph") return action === "read";
  return false;
}

function canModeratorAccess(action: AuthAction, kind: AuthResourceKind, roles: Set<AuthRole>): boolean {
  if (!roles.has("moderator")) return false;
  if (["proposal", "creator_submission", "master_graph"].includes(kind)) {
    return ["read", "moderate", "release", "update"].includes(action);
  }
  if (kind === "social_challenge") return ["read", "moderate", "update"].includes(action);
  return false;
}

function requiredRolesFor(action: AuthAction, kind: AuthResourceKind): AuthRole[] {
  if (kind === "admin_ops") return ["admin"];
  if (
    ["proposal", "creator_submission", "master_graph"].includes(kind) &&
    ["moderate", "release"].includes(action)
  ) {
    return ["moderator", "admin"];
  }
  if (kind === "analytics") return ["researcher", "admin"];
  if (kind === "service_job") return ["service", "admin"];
  return ["learner", "admin"];
}

function allowedSurfacesFor(roles: AuthRole[]): AuthResourceKind[] {
  const surfaces = new Set<AuthResourceKind>([
    "user_profile",
    "goal",
    "personal_graph",
    "daily_packet",
    "session",
    "assessment_response",
    "sleep_data",
    "health_data",
    "voice_data",
    "privacy_export",
    "privacy_delete",
    "master_graph",
    "proposal",
    "social_challenge",
    "experiment"
  ]);
  if (roles.includes("creator")) surfaces.add("creator_submission");
  if (roles.includes("moderator")) {
    surfaces.add("creator_submission");
  }
  if (roles.includes("researcher")) surfaces.add("analytics");
  if (roles.includes("service")) surfaces.add("service_job");
  if (roles.includes("admin")) {
    for (const surface of [
      "health_data",
      "creator_submission",
      "analytics",
      "admin_ops",
      "service_job"
    ] as AuthResourceKind[]) {
      surfaces.add(surface);
    }
  }
  return [...surfaces];
}

function allow(reason: string, requiredRoles: AuthRole[]): AuthorizationDecision {
  return { allowed: true, reason, required_roles: requiredRoles, audit_action: "allow" };
}

function deny(reason: string, requiredRoles: AuthRole[]): AuthorizationDecision {
  return { allowed: false, reason, required_roles: requiredRoles, audit_action: "deny" };
}

function deterministicToken(prefix: string, seed: string): string {
  return `${prefix}_${stableHash(seed).toString(36)}_${stableHash(`${seed}:shadow`).toString(36)}`;
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToHex(bytes)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
