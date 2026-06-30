import {
  authorizeAction,
  buildSecurityPosture,
  issueAuthSession,
  verifyAuthTokens,
  type AuthResource
} from "@mnemosyne/auth-core";
import { demoUser } from "@mnemosyne/demo-fixtures";
import { describe, expect, it } from "vitest";

describe("auth-core", () => {
  it("issues hashed sessions and verifies session and CSRF tokens", async () => {
    const issued = await issueAuthSession({
      userId: demoUser.id,
      provider: "passkey",
      roles: ["learner"],
      sessionSeed: "session-test",
      csrfSeed: "csrf-test",
      issuedAt: "2026-06-30T10:00:00.000Z",
      ttlMinutes: 60
    });

    expect(issued.session.session_token_hash).not.toContain(issued.session_token);
    expect(issued.session.csrf_token_hash).not.toContain(issued.csrf_token);
    expect(issued.session.session_token_hash).toHaveLength(64);
    expect(issued.session.csrf_token_hash).toHaveLength(64);

    await expect(
      verifyAuthTokens({
        session: issued.session,
        sessionToken: issued.session_token,
        csrfToken: issued.csrf_token,
        now: "2026-06-30T10:30:00.000Z"
      })
    ).resolves.toEqual({
      session_active: true,
      session_token_valid: true,
      csrf_token_valid: true
    });

    await expect(
      verifyAuthTokens({
        session: issued.session,
        sessionToken: "wrong-session-token",
        csrfToken: "wrong-csrf-token",
        now: "2026-06-30T10:30:00.000Z"
      })
    ).resolves.toEqual({
      session_active: true,
      session_token_valid: false,
      csrf_token_valid: false
    });
  });

  it("enforces object-level roles, ownership, and consent", async () => {
    const learner = await issueAuthSession({
      userId: demoUser.id,
      provider: "oauth",
      roles: ["learner"],
      sessionSeed: "learner",
      csrfSeed: "learner",
      issuedAt: "2026-06-30T10:00:00.000Z"
    });
    const moderator = await issueAuthSession({
      userId: "moderator_demo",
      provider: "passkey",
      roles: ["moderator"],
      sessionSeed: "moderator",
      csrfSeed: "moderator",
      issuedAt: "2026-06-30T10:00:00.000Z"
    });

    const ownGraph: AuthResource = { kind: "personal_graph", owner_id: demoUser.id };
    const otherGraph: AuthResource = { kind: "personal_graph", owner_id: "user_other" };
    const publicProposal: AuthResource = { kind: "proposal", object_id: "proposal_demo" };
    const researchAnalytics: AuthResource = {
      kind: "analytics",
      visibility: "aggregate",
      consent_required: "research"
    };

    const now = "2026-06-30T10:30:00.000Z";
    expect(
      authorizeAction({ session: learner.session, action: "read", resource: ownGraph, now }).allowed
    ).toBe(true);
    expect(
      authorizeAction({ session: learner.session, action: "read", resource: otherGraph, now }).allowed
    ).toBe(false);
    expect(
      authorizeAction({ session: moderator.session, action: "release", resource: publicProposal, now })
        .allowed
    ).toBe(true);
    expect(
      authorizeAction({ session: learner.session, action: "operate", resource: { kind: "admin_ops" }, now })
        .allowed
    ).toBe(false);
    expect(
      authorizeAction({
        session: learner.session,
        action: "read",
        resource: researchAnalytics,
        user: { ...demoUser, privacy_settings: { ...demoUser.privacy_settings, research_consent: false } },
        now
      }).allowed
    ).toBe(false);

    const posture = buildSecurityPosture({ session: learner.session, user: demoUser, now });
    expect(posture.csrf_required).toBe(true);
    expect(posture.private_default).toBe(true);
    expect(posture.allowed_surfaces).toContain("privacy_delete");
  });
});
