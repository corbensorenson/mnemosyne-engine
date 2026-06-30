import { clamp, round } from "@mnemosyne/shared-utils";

export const highStakesDomains = [
  "medical",
  "legal",
  "financial",
  "politics",
  "public_safety",
  "weapons",
  "self_harm",
  "drug_use"
] as const;
export type HighStakesDomain = (typeof highStakesDomains)[number];

export type HighStakesAssessment = {
  detected: boolean;
  domains: HighStakesDomain[];
  risk_score: number;
  matched_terms: string[];
  required_labels: string[];
  requires_expert_review: boolean;
  canonical_blocked_without_review: boolean;
};

export type SecurityHeaders = Record<string, string>;

export type RateLimitPolicy = {
  key: string;
  scope: "ip" | "user" | "session" | "service";
  window_seconds: number;
  max_requests: number;
  burst: number;
  expensive: boolean;
};

export type RateLimitDecision = {
  allowed: boolean;
  key: string;
  remaining: number;
  reset_at: string;
  retry_after_seconds?: number;
};

export type SecurityReleaseGate = {
  csp_present: boolean;
  csrf_required_for_mutation: boolean;
  rate_limits_present: boolean;
  high_stakes_labeled: boolean;
  expert_review_required_when_high_stakes: boolean;
  audit_safe: boolean;
  passed: boolean;
};

export function buildSecurityHeaders(input: {
  environment: "local" | "staging" | "production";
  reportUri?: string;
}): SecurityHeaders {
  const connectSrc = input.environment === "local" ? "'self' http://localhost:* ws://localhost:*" : "'self'";
  const report = input.reportUri ? `; report-uri ${input.reportUri}` : "";
  return {
    "Content-Security-Policy":
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        `connect-src ${connectSrc}`,
        "form-action 'self'",
        "upgrade-insecure-requests"
      ].join("; ") + report,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": [
      "camera=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "microphone=(self)",
      "encrypted-media=()"
    ].join(", ")
  };
}

export function defaultRateLimitPolicies(): RateLimitPolicy[] {
  return [
    policy("auth_session", "ip", 60, 20, 5, true),
    policy("tutor_turn", "user", 60, 60, 10, true),
    policy("proposal_create", "user", 300, 20, 4, true),
    policy("creator_ingestion", "user", 900, 10, 2, true),
    policy("offline_sync", "user", 60, 240, 60, true),
    policy("privacy_export", "user", 3600, 6, 1, true),
    policy("wearable_sync", "user", 300, 30, 5, true),
    policy("ops_job", "service", 60, 120, 20, false)
  ];
}

export function evaluateRateLimit(input: {
  policy: RateLimitPolicy;
  subjectId: string;
  timestamps: string[];
  at?: string;
}): RateLimitDecision {
  const at = input.at ?? new Date().toISOString();
  const now = Date.parse(at);
  const windowStart = now - input.policy.window_seconds * 1000;
  const hits = input.timestamps.filter((timestamp) => Date.parse(timestamp) > windowStart).sort();
  const allowedTotal = input.policy.max_requests + input.policy.burst;
  const allowed = hits.length < allowedTotal;
  const oldest = hits[0] ? Date.parse(hits[0]) : now;
  const resetAt = new Date(oldest + input.policy.window_seconds * 1000).toISOString();
  return {
    allowed,
    key: `${input.policy.key}:${input.policy.scope}:${input.subjectId}`,
    remaining: Math.max(0, allowedTotal - hits.length - (allowed ? 1 : 0)),
    reset_at: resetAt,
    retry_after_seconds: allowed ? undefined : Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000))
  };
}

export function classifyHighStakesContent(input: {
  title?: string;
  body?: string;
  sourceTitles?: string[];
  declaredDomains?: string[];
  riskLevel?: "low" | "medium" | "high" | "critical";
}): HighStakesAssessment {
  const haystack = normalize(
    [input.title, input.body, ...(input.sourceTitles ?? []), ...(input.declaredDomains ?? [])]
      .filter(Boolean)
      .join(" ")
  );
  const matches = Object.entries(domainTerms()).flatMap(([domain, terms]) =>
    terms
      .filter((term) => includesTerm(haystack, term))
      .map((term) => ({ domain: domain as HighStakesDomain, term }))
  );
  const domains = Array.from(new Set(matches.map((match) => match.domain)));
  const declaredRisk = input.riskLevel === "critical" ? 0.35 : input.riskLevel === "high" ? 0.2 : 0;
  const riskScore = clamp(domains.length * 0.22 + matches.length * 0.045 + declaredRisk);
  const detected = domains.length > 0 || riskScore >= 0.35;
  const requiredLabels = detected
    ? [
        "high_stakes",
        ...domains.map((domain) => `domain:${domain}`),
        "requires_source_labels",
        "requires_review_date",
        "no_personalized_advice"
      ]
    : [];
  return {
    detected,
    domains,
    risk_score: round(riskScore, 3),
    matched_terms: matches.map((match) => match.term),
    required_labels: requiredLabels,
    requires_expert_review: detected,
    canonical_blocked_without_review: detected
  };
}

export function buildSecurityReleaseGate(input: {
  headers: SecurityHeaders;
  rateLimitPolicies: RateLimitPolicy[];
  highStakes: HighStakesAssessment;
  mutationRequiresCsrf: boolean;
  auditPayload?: Record<string, unknown>;
}): SecurityReleaseGate {
  const cspPresent = Boolean(input.headers["Content-Security-Policy"]);
  const rateLimitsPresent = input.rateLimitPolicies.some((policy) => policy.expensive);
  const highStakesLabeled = !input.highStakes.detected || input.highStakes.required_labels.length >= 3;
  const expertReviewRequiredWhenHighStakes =
    !input.highStakes.detected || input.highStakes.requires_expert_review;
  const auditSafe = auditPayloadSafe(input.auditPayload ?? {});
  return {
    csp_present: cspPresent,
    csrf_required_for_mutation: input.mutationRequiresCsrf,
    rate_limits_present: rateLimitsPresent,
    high_stakes_labeled: highStakesLabeled,
    expert_review_required_when_high_stakes: expertReviewRequiredWhenHighStakes,
    audit_safe: auditSafe,
    passed:
      cspPresent &&
      input.mutationRequiresCsrf &&
      rateLimitsPresent &&
      highStakesLabeled &&
      expertReviewRequiredWhenHighStakes &&
      auditSafe
  };
}

export function highStakesLabelsForAudit(assessment: HighStakesAssessment): Record<string, unknown> {
  return {
    high_stakes_detected: assessment.detected,
    high_stakes_domains: assessment.domains,
    high_stakes_risk_score: assessment.risk_score,
    high_stakes_required_labels: assessment.required_labels,
    requires_expert_review: assessment.requires_expert_review
  };
}

function policy(
  key: string,
  scope: RateLimitPolicy["scope"],
  windowSeconds: number,
  maxRequests: number,
  burst: number,
  expensive: boolean
): RateLimitPolicy {
  return {
    key,
    scope,
    window_seconds: windowSeconds,
    max_requests: maxRequests,
    burst,
    expensive
  };
}

function domainTerms(): Record<HighStakesDomain, string[]> {
  return {
    medical: ["medical", "medicine", "doctor", "diagnosis", "disease", "dosage", "symptom", "therapy"],
    legal: ["legal", "law", "lawsuit", "contract", "court", "liability", "immigration", "criminal"],
    financial: ["financial", "investment", "stock", "option", "loan", "mortgage", "tax", "retirement"],
    politics: ["election", "vote", "campaign", "political", "policy", "candidate", "ballot"],
    public_safety: ["emergency", "public safety", "evacuation", "hazard", "disaster", "first aid"],
    weapons: ["weapon", "firearm", "explosive", "ammunition", "targeting"],
    self_harm: ["self harm", "suicide", "overdose", "cutting", "poison"],
    drug_use: ["drug", "opioid", "benzodiazepine", "steroid", "microdose", "controlled substance"]
  };
}

function auditPayloadSafe(payload: Record<string, unknown>): boolean {
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesTerm(normalized: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  return (
    new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}($|\\s)`).test(normalized) ||
    normalized.includes(normalizedTerm)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
