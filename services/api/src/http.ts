import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  buildSecurityHeaders,
  defaultRateLimitPolicies,
  evaluateRateLimit,
  type RateLimitDecision,
  type RateLimitPolicy,
  type SecurityHeaders
} from "@mnemosyne/security-core";
import { createMemoryStore, type MnemosyneStore } from "@mnemosyne/persistence-core";
import type { ObjectStorageAdapter } from "@mnemosyne/storage-core";
import { ZodError } from "zod";
import { createApiHandlers, type HandlerEnvelope } from "./handlers";
import { seedDemoStore } from "./seed";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type ApiHttpEnvironment = "local" | "staging" | "production";
type CsrfMode = "off" | "audit" | "enforce";
type JsonRecord = Record<string, unknown>;

export type ApiHttpOptions = {
  store: MnemosyneStore;
  environment?: ApiHttpEnvironment;
  reportUri?: string;
  csrfMode?: CsrfMode;
  maxBodyBytes?: number;
  rateLimitPolicies?: RateLimitPolicy[];
  rateLimitStore?: InMemoryRateLimitStore;
  objectStorage?: ObjectStorageAdapter;
};

type RouteContext = {
  request: IncomingMessage;
  url: URL;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
};

type RouteSpec = {
  method: HttpMethod;
  path: string;
  rateLimitKey?: string;
  csrfExempt?: boolean;
  invoke: (context: RouteContext) => Promise<HandlerEnvelope<unknown>>;
};

type JsonEnvelope = {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  audit_event_id?: string;
};

type ReadinessComponent = {
  status: "ok" | "error";
  checked_at: string;
  message?: string;
};

type ReadinessReport = {
  service: "mnemosyne-api";
  status: "ready" | "not_ready";
  environment: ApiHttpEnvironment;
  checked_at: string;
  components: {
    store: ReadinessComponent;
    object_storage: ReadinessComponent;
  };
};

export class InMemoryRateLimitStore {
  private readonly hits = new Map<string, string[]>();

  check(policy: RateLimitPolicy, subjectId: string, at = new Date().toISOString()): RateLimitDecision {
    const key = `${policy.key}:${policy.scope}:${subjectId}`;
    const timestamps = this.hits.get(key) ?? [];
    const decision = evaluateRateLimit({ policy, subjectId, timestamps, at });
    const windowStart = Date.parse(at) - policy.window_seconds * 1000;
    const retained = timestamps.filter((timestamp) => Date.parse(timestamp) > windowStart);
    if (decision.allowed) retained.push(at);
    this.hits.set(key, retained);
    return decision;
  }
}

export async function createSeededDemoApiHttpServer(
  options: Omit<ApiHttpOptions, "store"> = {}
): Promise<{ server: Server; store: MnemosyneStore }> {
  const store = createMemoryStore();
  await seedDemoStore(store);
  return {
    server: createApiHttpServer({ ...options, store }),
    store
  };
}

export function createApiHttpServer(options: ApiHttpOptions): Server {
  const handler = createApiHttpHandler(options);
  return createServer((request, response) => {
    void handler(request, response);
  });
}

export function createApiHttpHandler(options: ApiHttpOptions) {
  const environment = options.environment ?? "local";
  const csrfMode = options.csrfMode ?? (environment === "production" ? "enforce" : "audit");
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const securityHeaders = buildSecurityHeaders({ environment, reportUri: options.reportUri });
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();
  const policies = new Map(
    (options.rateLimitPolicies ?? defaultRateLimitPolicies()).map((policy) => [policy.key, policy])
  );
  const handlers = createApiHandlers(options.store, { objectStorage: options.objectStorage });
  const routes = createHttpRoutes(handlers);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method;
    const url = new URL(request.url ?? "/", "http://localhost");
    setBaseHeaders(response, securityHeaders);

    if (method === "OPTIONS") {
      sendJson(response, 204, undefined);
      return;
    }

    if (method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        data: {
          service: "mnemosyne-api",
          status: "live",
          environment
        }
      });
      return;
    }

    if (method === "GET" && url.pathname === "/readyz") {
      const readiness = await buildReadinessReport(options.store, options.objectStorage, environment);
      sendJson(response, readiness.status === "ready" ? 200 : 503, {
        ok: readiness.status === "ready",
        data: readiness,
        error:
          readiness.status === "ready"
            ? undefined
            : {
                code: "service_not_ready",
                message: "One or more required API dependencies failed readiness checks."
              }
      });
      return;
    }

    const route = routes
      .filter((candidate) => candidate.method === method)
      .map((candidate) => ({ candidate, params: matchPath(candidate.path, url.pathname) }))
      .find((match) => match.params);

    if (!route) {
      sendJson(response, 404, {
        ok: false,
        error: { code: "route_not_found", message: "Route not found" }
      });
      return;
    }

    try {
      const body = await parseRequestBody(request, maxBodyBytes);
      const context: RouteContext = {
        request,
        url,
        query: url.searchParams,
        params: route.params ?? {},
        body
      };
      const rateLimited = applyRateLimit(route.candidate, context, policies, rateLimitStore);
      if (rateLimited) {
        sendRateLimitResponse(response, rateLimited);
        return;
      }
      if (!csrfAllowed(route.candidate, request, csrfMode)) {
        sendJson(response, 403, {
          ok: false,
          error: {
            code: "csrf_required",
            message: "Mutating requests require an X-CSRF-Token or X-Mnemosyne-CSRF header."
          }
        });
        return;
      }
      const envelope = await route.candidate.invoke(context);
      sendJson(response, statusForEnvelope(envelope), envelope);
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(response, normalized.status, normalized.envelope);
    }
  };
}

function createHttpRoutes(handlers: ReturnType<typeof createApiHandlers>): RouteSpec[] {
  return [
    route("POST", "/api/onboarding/complete", (context) => handlers.completeOnboarding(context.body)),
    route("GET", "/api/me", (context) => handlers.getMe(requiredQuery(context, "userId"))),
    route("POST", "/api/auth/session", (context) => handlers.issueAuthSession(context.body), {
      rateLimitKey: "auth_session",
      csrfExempt: true
    }),
    route("POST", "/api/auth/verify", (context) => handlers.verifyAuthSession(context.body), {
      csrfExempt: true
    }),
    route("POST", "/api/auth/authorize", (context) => handlers.checkAuthorization(context.body)),
    route("PATCH", "/api/me/preferences", (context) => handlers.updatePreferences(context.body)),
    route(
      "GET",
      "/api/privacy/export",
      (context) => handlers.exportUserData({ userId: requiredQuery(context, "userId") }),
      { rateLimitKey: "privacy_export" }
    ),
    route("POST", "/api/privacy/export/jobs", (context) => handlers.queuePrivacyExport(context.body), {
      rateLimitKey: "privacy_export"
    }),
    route("POST", "/api/ops/backups/jobs", (context) => handlers.queueSystemBackup(context.body), {
      rateLimitKey: "ops_job"
    }),
    route(
      "POST",
      "/api/ops/backups/:id/restore-drills/jobs",
      (context) =>
        handlers.queueSystemBackupRestoreDrill(
          withBodyField(context, "objectManifestId", pathParam(context, "id"))
        ),
      { rateLimitKey: "ops_job" }
    ),
    route("DELETE", "/api/privacy/data", (context) => handlers.deleteUserData(context.body)),
    route("GET", "/api/me/capabilities", (context) =>
      handlers.getCapabilities(requiredQuery(context, "userId"))
    ),
    route("GET", "/api/goals", (context) => handlers.listGoals(requiredQuery(context, "userId"))),
    route("POST", "/api/goals", (context) => handlers.createGoal(context.body)),
    route("GET", "/api/daily-packet/today", (context) =>
      handlers.getTodayPacket(requiredQuery(context, "userId"), optionalQuery(context, "date"))
    ),
    route("POST", "/api/daily-packet/generate", (context) => handlers.generateDailyPacket(context.body)),
    route("POST", "/api/notifications/schedule", (context) => handlers.scheduleNotifications(context.body), {
      rateLimitKey: "ops_job"
    }),
    route("POST", "/api/offline/actions/sync", (context) => handlers.syncOfflineAction(context.body), {
      rateLimitKey: "offline_sync"
    }),
    route("POST", "/api/sessions/:id/events", (context) =>
      handlers.recordSessionEvent(withBodyField(context, "sessionId", pathParam(context, "id")))
    ),
    route("POST", "/api/tutor/turn", (context) => handlers.scoreTutorTurn(context.body), {
      rateLimitKey: "tutor_turn"
    }),
    route("POST", "/api/walk-mode/complete", (context) => handlers.completeWalkMode(context.body)),
    route("POST", "/api/assessments/:id/response", (context) => {
      ensureAssessmentRouteMatchesBody(context);
      return handlers.submitAssessmentResponse(context.body);
    }),
    route("POST", "/api/morning-forge/complete", (context) => handlers.completeMorningForge(context.body)),
    route("POST", "/api/evening-lock-in/complete", (context) => handlers.completeEveningLockIn(context.body)),
    route("GET", "/api/graph/master", () => handlers.getMasterGraph()),
    route("GET", "/api/graph/user", (context) => handlers.getUserGraph(requiredQuery(context, "userId"))),
    route("POST", "/api/graph/user/replay", (context) => handlers.replayUserGraph(context.body)),
    route("GET", "/api/videos/recommended", (context) =>
      handlers.recommendVideos({
        userId: requiredQuery(context, "userId"),
        limit: optionalNumberQuery(context, "limit")
      })
    ),
    route("POST", "/api/watch-packets/generate", (context) => handlers.generateWatchPacket(context.body)),
    route("POST", "/api/watch-packets/:id/complete", (context) =>
      handlers.completeWatchPacket(withBodyField(context, "watchPacketId", pathParam(context, "id")))
    ),
    route("POST", "/api/paced-read/generate", (context) => handlers.generatePacedRead(context.body)),
    route("POST", "/api/paced-read/complete", (context) => handlers.completePacedRead(context.body)),
    route("POST", "/api/sleep/packet/generate", (context) => handlers.generateSleepPacket(context.body)),
    route("GET", "/api/sleep/packet/tonight", (context) =>
      handlers.getTonightSleepPacket(requiredQuery(context, "userId"), optionalQuery(context, "nightDate"))
    ),
    route("POST", "/api/sleep/audio/render", (context) => handlers.renderSleepAudio(context.body)),
    route("POST", "/api/sleep/playback/events", (context) => handlers.recordSleepPlayback(context.body)),
    route("POST", "/api/sleep/recall/complete", (context) => handlers.completeSleepCueRecall(context.body)),
    route("POST", "/api/wearables/sync", (context) => handlers.syncWearableSleep(context.body), {
      rateLimitKey: "wearable_sync"
    }),
    route("GET", "/api/wearables/status", (context) =>
      handlers.getWearableStatus(requiredQuery(context, "userId"))
    ),
    route("POST", "/api/wearables/oura/connect", (context) => handlers.connectOuraWearable(context.body)),
    route("POST", "/api/wearables/:id/revoke", (context) =>
      handlers.revokeWearable(withBodyField(context, "connectionId", pathParam(context, "id")))
    ),
    route("POST", "/api/experiments/assign", (context) => handlers.assignExperiments(context.body)),
    route("GET", "/api/personalization/profile", (context) =>
      handlers.getPersonalizationProfile(requiredQuery(context, "userId"))
    ),
    route("GET", "/api/outcomes/dashboard", (context) =>
      handlers.getOutcomeDashboard(requiredQuery(context, "userId"))
    ),
    route("POST", "/api/outcomes/refresh", (context) => handlers.refreshOutcomeDashboard(context.body)),
    route(
      "POST",
      "/api/outcomes/refresh/jobs",
      (context) => handlers.queueOutcomeDashboardRefresh(context.body),
      { rateLimitKey: "ops_job" }
    ),
    route("POST", "/api/jobs", (context) => handlers.createJob(context.body), { rateLimitKey: "ops_job" }),
    route(
      "POST",
      "/api/jobs/:id/start",
      (context) => handlers.startJob(withBodyField(context, "jobId", pathParam(context, "id"))),
      { rateLimitKey: "ops_job" }
    ),
    route(
      "POST",
      "/api/jobs/:id/complete",
      (context) => handlers.completeJob(withBodyField(context, "jobId", pathParam(context, "id"))),
      { rateLimitKey: "ops_job" }
    ),
    route(
      "POST",
      "/api/jobs/:id/fail",
      (context) => handlers.failJob(withBodyField(context, "jobId", pathParam(context, "id"))),
      { rateLimitKey: "ops_job" }
    ),
    route("POST", "/api/objects", (context) => handlers.createObjectManifest(context.body), {
      rateLimitKey: "ops_job"
    }),
    route("POST", "/api/objects/store", (context) => handlers.putObject(context.body), {
      rateLimitKey: "ops_job"
    }),
    route("GET", "/api/ops/monitoring", (context) =>
      handlers.getOpsMonitoring({
        userId: requiredQuery(context, "userId"),
        environment: optionalQuery(context, "environment") ?? "production",
        reportUri: optionalQuery(context, "reportUri")
      })
    ),
    route("POST", "/api/ops/incidents/reports", (context) => handlers.createOpsIncidentReport(context.body), {
      rateLimitKey: "ops_job"
    }),
    route("GET", "/api/ops/health", (context) => handlers.getOpsHealth(requiredQuery(context, "userId"))),
    route("GET", "/api/security/release-gate", (context) =>
      handlers.getSecurityReleaseGate({
        userId: requiredQuery(context, "userId"),
        environment: optionalQuery(context, "environment") ?? "production",
        reportUri: optionalQuery(context, "reportUri")
      })
    ),
    route("GET", "/api/accessibility/release-gate", (context) =>
      handlers.getAccessibilityReleaseGate({
        userId: requiredQuery(context, "userId"),
        environment: optionalQuery(context, "environment") ?? "production"
      })
    ),
    route("GET", "/api/reliability/release-gate", (context) =>
      handlers.getReliabilityReleaseGate({
        userId: requiredQuery(context, "userId"),
        environment: optionalQuery(context, "environment") ?? "production"
      })
    ),
    route("POST", "/api/proposals", (context) => handlers.createProposal(context.body), {
      rateLimitKey: "proposal_create"
    }),
    route("POST", "/api/proposals/:id/ai-review", (context) =>
      handlers.reviewProposal(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/arbiter/jobs", (context) =>
      handlers.queueProposalArbiterReview(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/moderation/jobs", (context) =>
      handlers.queueProposalModeration(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/vote", (context) =>
      handlers.voteOnProposal(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/comment", (context) =>
      handlers.commentOnProposal(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/human-override", (context) =>
      handlers.humanOverrideProposal(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/proposals/:id/release", (context) =>
      handlers.releaseProposal(withBodyField(context, "proposalId", pathParam(context, "id")))
    ),
    route("POST", "/api/creator/ingestions", (context) => handlers.submitCreatorIngestion(context.body), {
      rateLimitKey: "creator_ingestion"
    }),
    route("POST", "/api/creator/ingestions/jobs", (context) => handlers.queueCreatorIngestion(context.body), {
      rateLimitKey: "creator_ingestion"
    }),
    route("GET", "/api/creator/ingestions", (context) =>
      handlers.listCreatorIngestions(requiredQuery(context, "creatorId"))
    ),
    route("GET", "/api/creator/ingestions/:id", (context) =>
      handlers.getCreatorIngestion(requiredQuery(context, "creatorId"), pathParam(context, "id"))
    ),
    route("GET", "/api/packs", (context) => handlers.listPacks(requiredQuery(context, "userId"))),
    route("GET", "/api/social/dashboard", (context) =>
      handlers.getSocialDashboard(requiredQuery(context, "userId"))
    ),
    route("GET", "/api/challenges", (context) => handlers.listChallenges(requiredQuery(context, "userId"))),
    route("POST", "/api/challenges", (context) => handlers.createChallenge(context.body)),
    route("GET", "/api/badges", (context) => handlers.listBadges(requiredQuery(context, "userId")))
  ];
}

async function buildReadinessReport(
  store: MnemosyneStore,
  objectStorage: ObjectStorageAdapter | undefined,
  environment: ApiHttpEnvironment
): Promise<ReadinessReport> {
  const checkedAt = new Date().toISOString();
  const [storeComponent, objectStorageComponent] = await Promise.all([
    checkReadinessComponent(checkedAt, async () => {
      await Promise.all([store.getMasterGraph(), store.listJobs(), store.listObjectManifests()]);
    }),
    objectStorage
      ? checkReadinessComponent(checkedAt, async () => {
          await objectStorage.listManifests();
        })
      : Promise.resolve({
          status: "error" as const,
          checked_at: checkedAt,
          message: "Object storage adapter is not configured."
        })
  ]);
  const ready = storeComponent.status === "ok" && objectStorageComponent.status === "ok";
  return {
    service: "mnemosyne-api",
    status: ready ? "ready" : "not_ready",
    environment,
    checked_at: checkedAt,
    components: {
      store: storeComponent,
      object_storage: objectStorageComponent
    }
  };
}

async function checkReadinessComponent(
  checkedAt: string,
  check: () => Promise<void>
): Promise<ReadinessComponent> {
  try {
    await check();
    return { status: "ok", checked_at: checkedAt };
  } catch (error) {
    return {
      status: "error",
      checked_at: checkedAt,
      message: errorMessage(error)
    };
  }
}

function route(
  method: HttpMethod,
  path: string,
  invoke: RouteSpec["invoke"],
  options: Pick<RouteSpec, "rateLimitKey" | "csrfExempt"> = {}
): RouteSpec {
  return { method, path, invoke, ...options };
}

function applyRateLimit(
  routeSpec: RouteSpec,
  context: RouteContext,
  policies: Map<string, RateLimitPolicy>,
  store: InMemoryRateLimitStore
): RateLimitDecision | undefined {
  if (!routeSpec.rateLimitKey) return undefined;
  const policy = policies.get(routeSpec.rateLimitKey);
  if (!policy) return undefined;
  const subjectId = rateLimitSubject(context, policy);
  const decision = store.check(policy, subjectId);
  return decision.allowed ? undefined : decision;
}

function rateLimitSubject(context: RouteContext, policy: RateLimitPolicy): string {
  if (policy.scope === "ip") return remoteSubject(context);
  if (policy.scope === "service") return "api";

  const body = isJsonRecord(context.body) ? context.body : {};
  if (policy.scope === "session" && isJsonRecord(body.session) && typeof body.session.id === "string") {
    return body.session.id;
  }
  const bodyCandidates = [
    body.userId,
    body.creatorId,
    body.proposerId,
    body.voterId,
    body.authorId,
    body.moderatorId,
    body.releaserId,
    isJsonRecord(body.item) ? body.item.user_id : undefined,
    isJsonRecord(body.session) ? body.session.user_id : undefined
  ];
  const queryCandidates = [context.query.get("userId"), context.query.get("creatorId")];
  const candidate = [...bodyCandidates, ...queryCandidates].find(
    (value) => typeof value === "string" && value
  );
  if (typeof candidate === "string") return candidate;
  return remoteSubject(context);
}

function remoteSubject(context: RouteContext): string {
  return context.request.socket.remoteAddress ?? "unknown";
}

function csrfAllowed(routeSpec: RouteSpec, request: IncomingMessage, mode: CsrfMode): boolean {
  if (mode !== "enforce") return true;
  if (routeSpec.csrfExempt) return true;
  if (request.method === "GET") return true;
  return Boolean(request.headers["x-csrf-token"] || request.headers["x-mnemosyne-csrf"]);
}

function statusForEnvelope(envelope: HandlerEnvelope<unknown>): number {
  if (envelope.ok) return 200;
  if (envelope.error?.code.includes("not_found")) return 404;
  return 400;
}

function sendRateLimitResponse(response: ServerResponse, decision: RateLimitDecision): void {
  response.setHeader("Retry-After", String(decision.retry_after_seconds ?? 1));
  response.setHeader("X-RateLimit-Key", decision.key);
  response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  response.setHeader("X-RateLimit-Reset", decision.reset_at);
  sendJson(response, 429, {
    ok: false,
    error: {
      code: "rate_limit_exceeded",
      message: "Rate limit exceeded",
      details: decision
    }
  });
}

function setBaseHeaders(response: ServerResponse, securityHeaders: SecurityHeaders): void {
  for (const [key, value] of Object.entries(securityHeaders)) response.setHeader(key, value);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response: ServerResponse, statusCode: number, envelope: JsonEnvelope | undefined): void {
  response.statusCode = statusCode;
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(envelope));
}

async function parseRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return {};
  const raw = await readRequestBody(request, maxBodyBytes);
  if (!raw.trim()) return {};
  const contentType = String(request.headers["content-type"] ?? "");
  if (!contentType.includes("application/json")) {
    throw new HttpFailure(415, "unsupported_media_type", "Request body must be application/json.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpFailure(400, "invalid_json", "Request body must contain valid JSON.");
  }
}

async function readRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBodyBytes) {
      throw new HttpFailure(413, "payload_too_large", "Request body exceeds the configured limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart?.startsWith(":")) {
      const key = patternPart.slice(1);
      try {
        params[key] = decodeURIComponent(pathPart ?? "");
      } catch {
        return undefined;
      }
    } else if (patternPart !== pathPart) {
      return undefined;
    }
  }
  return params;
}

function requiredQuery(context: RouteContext, key: string): string {
  const value = optionalQuery(context, key);
  if (!value) throw new HttpFailure(400, "missing_query", `Missing required query parameter: ${key}.`);
  return value;
}

function optionalQuery(context: RouteContext, key: string): string | undefined {
  return context.query.get(key) ?? undefined;
}

function optionalNumberQuery(context: RouteContext, key: string): number | undefined {
  const value = optionalQuery(context, key);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpFailure(400, "invalid_query", `Query parameter ${key} must be a number.`);
  }
  return parsed;
}

function pathParam(context: RouteContext, key: string): string {
  const value = context.params[key];
  if (!value) throw new HttpFailure(400, "missing_path_parameter", `Missing path parameter: ${key}.`);
  return value;
}

function withBodyField(context: RouteContext, key: string, value: string): JsonRecord {
  const body = requireObjectBody(context);
  return { ...body, [key]: value };
}

function requireObjectBody(context: RouteContext): JsonRecord {
  if (isJsonRecord(context.body)) return context.body;
  throw new HttpFailure(400, "invalid_body", "Request body must be a JSON object.");
}

function ensureAssessmentRouteMatchesBody(context: RouteContext): void {
  const id = pathParam(context, "id");
  const body = requireObjectBody(context);
  const item = body.item;
  if (isJsonRecord(item) && typeof item.id === "string" && item.id !== id) {
    throw new HttpFailure(400, "assessment_route_mismatch", "Assessment route id must match item.id.");
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeError(error: unknown): { status: number; envelope: JsonEnvelope } {
  if (error instanceof HttpFailure) {
    return {
      status: error.status,
      envelope: {
        ok: false,
        error: { code: error.code, message: error.message }
      }
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      envelope: {
        ok: false,
        error: {
          code: "validation_error",
          message: "Request validation failed.",
          details: error.issues
        }
      }
    };
  }
  return {
    status: 500,
    envelope: {
      ok: false,
      error: { code: "internal_error", message: "Internal server error." }
    }
  };
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
