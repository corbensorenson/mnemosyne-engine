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

export type ModerationTriageAction =
  | "review_ready"
  | "request_more_evidence"
  | "send_to_human_moderation"
  | "mark_as_disputed"
  | "freeze_release";

export type ModerationTriage = {
  id: string;
  proposal_id: string;
  generated_at: string;
  policy_version: string;
  risk_level: Proposal["risk_level"];
  required_action: ModerationTriageAction;
  next_status: Proposal["status"];
  priority: "low" | "normal" | "high" | "critical";
  reasons: string[];
  policy_checks: {
    high_stakes_labeled: boolean;
    source_gap: boolean;
    low_source_quality: boolean;
    counterevidence_outweighs_support: boolean;
    high_risk: boolean;
    critical_risk: boolean;
    large_change: boolean;
    dispute_signals: boolean;
  };
  source_quality: number;
  opposition_quality: number;
  bridging_priority: number;
};

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
    ["wrong", "outdated", "misleading", "wrong_prerequisite", "bad_sleep_cue"].some((vote) =>
      key.startsWith(vote)
    )
  ).length;
  const riskBoost = { low: 0.05, medium: 0.18, high: 0.35, critical: 0.5 }[proposal.risk_level];
  return clamp(
    (helpfulAcrossPerspectives + disputeSignals * 1.4) / Math.max(voteEntries.length, 1) + riskBoost
  );
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
    pedagogy_audit: {
      expected_learning_impact: proposal.expected_learning_impact ?? "unknown",
      prerequisite_risk: "check"
    },
    safety_audit: { risk_level: proposal.risk_level, human_review_required: riskNeedsHuman },
    confidence: clamp(
      weightedAverage([
        { value: sourceQuality, weight: 0.5 },
        { value: 1 - oppositionQuality, weight: 0.2 },
        { value: proposal.risk_level === "low" ? 0.8 : 0.45, weight: 0.3 }
      ])
    ),
    appealable: true,
    required_review_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
    model_version: "policy-simulated-local-arbiter-v0.1",
    policy_version: "mnemosyne-content-court-v0.1",
    created_at: nowIso()
  };
}

export function statusForArbiterDecision(decision: ArbiterVerdict["decision"]): Proposal["status"] {
  if (decision === "accept") return "accepted";
  if (decision === "accept_with_modifications") return "accepted_with_modifications";
  if (decision === "reject") return "rejected";
  if (decision === "mark_as_disputed") return "disputed";
  if (decision === "send_to_human_moderation") return "human_review_required";
  if (decision === "needs_more_evidence") return "needs_evidence";
  return "ai_reviewing";
}

export function triageProposalForModeration(proposal: Proposal, generatedAt = nowIso()): ModerationTriage {
  const sourceQuality = sourceQualityScore(proposal.evidence_for);
  const oppositionQuality = sourceQualityScore(proposal.evidence_against);
  const bridgingPriority = computeBridgingPriority(proposal);
  const policyChecks = {
    high_stakes_labeled: hasHighStakesLabel(proposal.diff),
    source_gap: proposal.evidence_for.length === 0 && requiresEvidence(proposal.proposal_type),
    low_source_quality: proposal.evidence_for.length > 0 && sourceQuality < 0.55,
    counterevidence_outweighs_support:
      proposal.evidence_against.length > 0 && oppositionQuality > sourceQuality + 0.15,
    high_risk: proposal.risk_level === "high" || proposal.risk_level === "critical",
    critical_risk: proposal.risk_level === "critical",
    large_change: proposal.affected_object_ids.length > 5 || serializedLength(proposal.diff) > 4_000,
    dispute_signals: hasDisputeSignals(proposal)
  };
  const reasons: string[] = [];

  if (policyChecks.critical_risk) reasons.push("critical proposal risk requires release freeze");
  if (policyChecks.high_stakes_labeled) reasons.push("high-stakes labels require domain review");
  if (policyChecks.high_risk) reasons.push("high proposal risk requires human moderation");
  if (policyChecks.large_change) reasons.push("large graph change requires moderator review");
  if (policyChecks.source_gap) reasons.push("proposal lacks required supporting evidence");
  if (policyChecks.low_source_quality) reasons.push("supporting evidence quality is below merge threshold");
  if (policyChecks.counterevidence_outweighs_support) {
    reasons.push("opposing evidence outweighs supporting evidence");
  }
  if (policyChecks.dispute_signals) reasons.push("community signals indicate dispute or expert review need");

  const requiredAction = moderationActionFor(policyChecks);
  const nextStatus = moderationStatusFor(requiredAction, proposal.status);

  return {
    id: createId("moderation_triage", `${proposal.id}:${generatedAt}`),
    proposal_id: proposal.id,
    generated_at: generatedAt,
    policy_version: "mnemosyne-content-court-moderation-v0.1",
    risk_level: proposal.risk_level,
    required_action: requiredAction,
    next_status: nextStatus,
    priority: moderationPriorityFor(requiredAction, proposal.risk_level),
    reasons: reasons.length ? reasons : ["proposal is ready for standard human acceptance or release review"],
    policy_checks: policyChecks,
    source_quality: sourceQuality,
    opposition_quality: oppositionQuality,
    bridging_priority: bridgingPriority
  };
}

function requiresEvidence(proposalType: Proposal["proposal_type"]): boolean {
  return !["change_badge", "add_assessment", "rank_video"].includes(proposalType);
}

function sourceQualityScore(sources: SourceRef[]): number {
  if (sources.length === 0) return 0;
  return sources.reduce((sum, source) => sum + source.quality_score, 0) / sources.length;
}

function moderationActionFor(checks: ModerationTriage["policy_checks"]): ModerationTriageAction {
  if (checks.critical_risk) return "freeze_release";
  if (checks.high_stakes_labeled || checks.high_risk || checks.large_change) {
    return "send_to_human_moderation";
  }
  if (checks.counterevidence_outweighs_support || checks.dispute_signals) return "mark_as_disputed";
  if (checks.source_gap || checks.low_source_quality) return "request_more_evidence";
  return "review_ready";
}

function moderationStatusFor(
  action: ModerationTriageAction,
  currentStatus: Proposal["status"]
): Proposal["status"] {
  if (["accepted", "accepted_with_modifications", "merged", "rejected", "reverted"].includes(currentStatus)) {
    return currentStatus;
  }
  if (action === "freeze_release" || action === "send_to_human_moderation") {
    return "human_review_required";
  }
  if (action === "mark_as_disputed") return "disputed";
  if (action === "request_more_evidence") return "needs_evidence";
  return currentStatus === "ai_reviewing" ? "open" : currentStatus;
}

function moderationPriorityFor(
  action: ModerationTriageAction,
  riskLevel: Proposal["risk_level"]
): ModerationTriage["priority"] {
  if (action === "freeze_release" || riskLevel === "critical") return "critical";
  if (action === "send_to_human_moderation" || riskLevel === "high") return "high";
  if (action === "mark_as_disputed" || action === "request_more_evidence") return "normal";
  return "low";
}

function hasHighStakesLabel(diff: Record<string, unknown>): boolean {
  const review = diff.security_review;
  return isRecord(review) && review.high_stakes_detected === true;
}

function hasDisputeSignals(proposal: Proposal): boolean {
  return Object.keys(proposal.community_votes).some((key) =>
    ["wrong:", "outdated:", "misleading:", "wrong_prerequisite:", "needs_expert_review:"].some((prefix) =>
      key.startsWith(prefix)
    )
  );
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
