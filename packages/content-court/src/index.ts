import type { ArbiterVerdict, Proposal, SourceRef } from "@mnemosyne/schema";
import { clamp, createId, nowIso, weightedAverage } from "@mnemosyne/shared-utils";

export type VoteType =
  | "clear"
  | "unclear"
  | "accurate"
  | "wrong"
  | "outdated"
  | "too_easy"
  | "too_hard"
  | "misleading"
  | "great_for_beginners"
  | "great_for_experts"
  | "bad_sleep_cue"
  | "good_sleep_cue"
  | "wrong_prerequisite"
  | "better_video_exists"
  | "needs_expert_review";

export function createProposal(input: {
  proposerId: string | "ai_agent";
  proposalType: Proposal["proposal_type"];
  affectedObjectIds: string[];
  diff: Record<string, unknown>;
  rationale: string;
  evidenceFor?: SourceRef[];
  evidenceAgainst?: SourceRef[];
  riskLevel?: Proposal["risk_level"];
}): Proposal {
  return {
    id: createId("proposal"),
    proposer_id: input.proposerId,
    proposal_type: input.proposalType,
    affected_object_ids: input.affectedObjectIds,
    diff: input.diff,
    rationale: input.rationale,
    evidence_for: input.evidenceFor ?? [],
    evidence_against: input.evidenceAgainst ?? [],
    expected_learning_impact: "Pending outcome data",
    risk_level: input.riskLevel ?? "low",
    community_votes: {},
    expert_comments: [],
    status: input.riskLevel === "high" || input.riskLevel === "critical" ? "human_review_required" : "open",
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

export function castVote(proposal: Proposal, voteType: VoteType, perspectiveId: string): Proposal {
  const key = `${voteType}:${perspectiveId}`;
  return {
    ...proposal,
    community_votes: {
      ...proposal.community_votes,
      [key]: (proposal.community_votes[key] ?? 0) + 1
    },
    updated_at: nowIso()
  };
}

export function computeBridgingPriority(proposal: Proposal): number {
  const voteEntries = Object.entries(proposal.community_votes);
  if (voteEntries.length === 0) return proposal.risk_level === "critical" ? 1 : 0.3;
  const helpfulAcrossPerspectives = voteEntries.filter(([key]) =>
    ["clear", "accurate", "great_for_beginners", "great_for_experts", "needs_expert_review"].some((vote) =>
      key.startsWith(vote)
    )
  ).length;
  const disputeSignals = voteEntries.filter(([key]) =>
    ["wrong", "outdated", "misleading", "wrong_prerequisite", "bad_sleep_cue"].some((vote) => key.startsWith(vote))
  ).length;
  const riskBoost = { low: 0.05, medium: 0.18, high: 0.35, critical: 0.5 }[proposal.risk_level];
  return clamp((helpfulAcrossPerspectives + disputeSignals * 1.4) / Math.max(voteEntries.length, 1) + riskBoost);
}

export function arbitrateProposal(proposal: Proposal): ArbiterVerdict {
  const sourceQuality = sourceQualityScore(proposal.evidence_for);
  const oppositionQuality = sourceQualityScore(proposal.evidence_against);
  const riskNeedsHuman = proposal.risk_level === "high" || proposal.risk_level === "critical";
  const evidenceGap = proposal.evidence_for.length === 0 && requiresEvidence(proposal.proposal_type);
  const decision: ArbiterVerdict["decision"] = riskNeedsHuman
    ? "send_to_human_moderation"
    : evidenceGap
      ? "needs_more_evidence"
      : oppositionQuality > sourceQuality + 0.2
        ? "mark_as_disputed"
        : sourceQuality >= 0.68
          ? "accept_with_modifications"
          : "needs_more_evidence";

  return {
    id: createId("verdict", proposal.id),
    proposal_id: proposal.id,
    decision,
    reasoning_summary:
      decision === "send_to_human_moderation"
        ? "Risk level requires human or domain-reviewer oversight before publication."
        : decision === "needs_more_evidence"
          ? "The proposal needs stronger source support before it can affect canonical graph state."
          : decision === "mark_as_disputed"
            ? "Counterevidence is materially stronger than the submitted support."
            : "Sources support a cautious merge, with outcome monitoring and review-after metadata.",
    strongest_argument_for: proposal.rationale,
    strongest_argument_against:
      proposal.evidence_against[0]?.title ?? "No strong counterargument was submitted.",
    source_audit: [
      {
        supporting_sources: proposal.evidence_for.length,
        opposing_sources: proposal.evidence_against.length,
        source_quality: sourceQuality,
        opposition_quality: oppositionQuality
      }
    ],
    ontology_audit: { affected_objects: proposal.affected_object_ids, split_needed: false },
    pedagogy_audit: { expected_learning_impact: proposal.expected_learning_impact ?? "unknown", prerequisite_risk: "check" },
    safety_audit: { risk_level: proposal.risk_level, human_review_required: riskNeedsHuman },
    confidence: clamp(weightedAverage([
      { value: sourceQuality, weight: 0.5 },
      { value: 1 - oppositionQuality, weight: 0.2 },
      { value: proposal.risk_level === "low" ? 0.8 : 0.45, weight: 0.3 }
    ])),
    appealable: true,
    required_review_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
    model_version: "policy-simulated-local-arbiter-v0.1",
    policy_version: "mnemosyne-content-court-v0.1",
    created_at: nowIso()
  };
}

function requiresEvidence(proposalType: Proposal["proposal_type"]): boolean {
  return !["change_badge", "add_assessment", "rank_video"].includes(proposalType);
}

function sourceQualityScore(sources: SourceRef[]): number {
  if (sources.length === 0) return 0;
  return sources.reduce((sum, source) => sum + source.quality_score, 0) / sources.length;
}
