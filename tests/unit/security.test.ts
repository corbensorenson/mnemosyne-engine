import {
  buildSecurityHeaders,
  buildSecurityReleaseGate,
  classifyHighStakesContent,
  defaultRateLimitPolicies,
  evaluateRateLimit
} from "@mnemosyne/security-core";
import { describe, expect, it } from "vitest";

describe("security-core", () => {
  it("builds production security headers with a strict CSP", () => {
    const headers = buildSecurityHeaders({
      environment: "production",
      reportUri: "https://example.test/csp"
    });

    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
  });

  it("classifies high-stakes content and requires expert review", () => {
    const assessment = classifyHighStakesContent({
      title: "Medical dosage for emergency first aid",
      body: "Discuss diagnosis, symptom triage, dosage, and evacuation.",
      riskLevel: "low"
    });

    expect(assessment.detected).toBe(true);
    expect(assessment.domains).toEqual(expect.arrayContaining(["medical", "public_safety"]));
    expect(assessment.requires_expert_review).toBe(true);
    expect(assessment.required_labels).toContain("no_personalized_advice");
  });

  it("evaluates rate limits and release gates", () => {
    const policy = defaultRateLimitPolicies().find((candidate) => candidate.key === "tutor_turn");
    if (!policy) throw new Error("missing tutor_turn policy");
    expect(defaultRateLimitPolicies()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "speed_listen_completion",
          scope: "user",
          expensive: true
        })
      ])
    );
    const timestamps = Array.from({ length: policy.max_requests + policy.burst }, (_, index) =>
      new Date(Date.parse("2026-06-30T12:00:00.000Z") + index * 100).toISOString()
    );
    const decision = evaluateRateLimit({
      policy,
      subjectId: "user_demo",
      timestamps,
      at: "2026-06-30T12:00:30.000Z"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retry_after_seconds).toBeGreaterThan(0);

    const gate = buildSecurityReleaseGate({
      headers: buildSecurityHeaders({ environment: "production" }),
      rateLimitPolicies: defaultRateLimitPolicies(),
      highStakes: classifyHighStakesContent({}),
      mutationRequiresCsrf: true,
      auditPayload: { action: "safe_audit" }
    });
    expect(gate.passed).toBe(true);

    const unsafeGate = buildSecurityReleaseGate({
      headers: buildSecurityHeaders({ environment: "production" }),
      rateLimitPolicies: defaultRateLimitPolicies(),
      highStakes: classifyHighStakesContent({ title: "Legal contract liability" }),
      mutationRequiresCsrf: true,
      auditPayload: { access_token: "secret" }
    });
    expect(unsafeGate.audit_safe).toBe(false);
    expect(unsafeGate.passed).toBe(false);
  });
});
