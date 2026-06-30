import {
  createProposal,
  statusForArbiterDecision,
  triageProposalForModeration
} from "@mnemosyne/content-court";
import { describe, expect, it } from "vitest";

describe("content-court moderation triage", () => {
  it("maps local arbiter decisions to proposal governance states", () => {
    expect(statusForArbiterDecision("accept_with_modifications")).toBe("accepted_with_modifications");
    expect(statusForArbiterDecision("send_to_human_moderation")).toBe("human_review_required");
    expect(statusForArbiterDecision("needs_more_evidence")).toBe("needs_evidence");
  });

  it("routes high-stakes proposal labels to human moderation without external services", () => {
    const proposal = createProposal({
      proposerId: "creator_demo",
      proposalType: "add_claim",
      affectedObjectIds: ["claim_sleep_medical"],
      diff: {
        add_claim: {
          subject_id: "sleep",
          object_value: "clinical insomnia dosage advice"
        },
        security_review: {
          high_stakes_detected: true,
          requires_expert_review: true
        }
      },
      rationale: "Medical learning claims need expert review before canonical graph release.",
      evidenceFor: [
        {
          id: "source_guideline",
          title: "Clinical guideline",
          source_type: "expert",
          quality_score: 0.9
        }
      ],
      riskLevel: "low"
    });

    const triage = triageProposalForModeration(proposal, "2026-06-30T15:00:00.000Z");

    expect(triage).toEqual(
      expect.objectContaining({
        proposal_id: proposal.id,
        required_action: "send_to_human_moderation",
        next_status: "human_review_required",
        priority: "high",
        policy_version: "mnemosyne-content-court-moderation-v0.1"
      })
    );
    expect(triage.policy_checks.high_stakes_labeled).toBe(true);
    expect(triage.reasons).toContain("high-stakes labels require domain review");
  });

  it("keeps well-sourced low-risk proposals on the standard review path", () => {
    const proposal = createProposal({
      proposerId: "creator_demo",
      proposalType: "modify_definition",
      affectedObjectIds: ["attention_qkv"],
      diff: { before: "attention weights values", after: "queries compare with keys to weight values" },
      rationale: "Clarifies a common attention definition without changing safety-sensitive guidance.",
      evidenceFor: [
        {
          id: "source_attention",
          title: "Attention paper",
          source_type: "paper",
          quality_score: 0.86
        }
      ],
      riskLevel: "low"
    });

    const triage = triageProposalForModeration(proposal, "2026-06-30T15:00:00.000Z");

    expect(triage.required_action).toBe("review_ready");
    expect(triage.next_status).toBe("open");
    expect(triage.priority).toBe("low");
    expect(triage.policy_checks.source_gap).toBe(false);
  });
});
