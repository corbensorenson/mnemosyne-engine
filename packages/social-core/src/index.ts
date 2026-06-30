import type { BadgeTemplate, LearningEvent, Proposal, User, UserConceptState } from "@mnemosyne/schema";
import { clamp, createId, nowIso, round } from "@mnemosyne/shared-utils";

export type ChallengeType =
  | "retention_duel"
  | "boss_fight"
  | "screen_efficiency"
  | "walk_recall"
  | "same_video_recall"
  | "sleep_cue_gain"
  | "creator_quality";

export type ShareLevel = "private" | "badges_only" | "friends" | "public";

export type SocialChallenge = {
  id: string;
  creator_id: string;
  title: string;
  challenge_type: ChallengeType;
  participant_ids: string[];
  share_level: Exclude<ShareLevel, "private">;
  scoring_metric: OutcomeMetricKey;
  anti_gaming_policy: string[];
  status: "open" | "active" | "completed" | "archived";
  scoreboard: ChallengeScore[];
  created_at: string;
  ends_at?: string;
};

export type ChallengeScore = {
  user_id: string;
  display_name: string;
  score: number;
  rank: number;
  evidence: string[];
};

export type AwardedBadge = {
  id: string;
  user_id: string;
  badge_id: string;
  title: string;
  category: BadgeTemplate["category"];
  rarity: BadgeTemplate["rarity"];
  awarded_at: string;
  score: number;
  evidence: string[];
};

export type ContributorReputation = {
  user_id: string;
  accepted_contributions: number;
  merged_contributions: number;
  outcome_positive_contributions: number;
  disputed_contributions: number;
  evidence_quality: number;
  reputation_score: number;
  moderation_queue_priority: "normal" | "trusted_fast_track" | "needs_review";
};

export type SocialEvidence = {
  user: User;
  states: UserConceptState[];
  events: LearningEvent[];
  proposals: Proposal[];
  creatorSubmissionCount: number;
};

export type SocialDashboard = {
  user_id: string;
  share_level: ShareLevel;
  public_profile: {
    handle: string;
    display_name: string;
    visible_badge_count: number;
    visible_challenge_count: number;
  };
  outcome_metrics: Record<OutcomeMetricKey, number>;
  badges: AwardedBadge[];
  challenges: SocialChallenge[];
  contributor_reputation: ContributorReputation;
  guardrails: string[];
  generated_at: string;
};

type OutcomeMetricKey =
  | "retention"
  | "transfer"
  | "consistency"
  | "screen_efficiency"
  | "walk_recall"
  | "sleep_integrity"
  | "sleep_cue_gain"
  | "contribution_quality";

const challengeMetricByType: Record<ChallengeType, OutcomeMetricKey> = {
  retention_duel: "retention",
  boss_fight: "transfer",
  screen_efficiency: "screen_efficiency",
  walk_recall: "walk_recall",
  same_video_recall: "screen_efficiency",
  sleep_cue_gain: "sleep_cue_gain",
  creator_quality: "contribution_quality"
};

export const socialGuardrails = [
  "No rewards for raw app time.",
  "No rewards for raw video minutes.",
  "Challenge scores must use retention, transfer, calibration, screen efficiency, sleep integrity, or contribution quality.",
  "Private profiles reveal nothing; badges-only profiles reveal earned badge count and titles only."
];

export const outcomeBadgeTemplates: BadgeTemplate[] = [
  {
    id: "badge_retention_anchor",
    title: "Retention Anchor",
    description: "Keep average recall strength high across active concepts.",
    category: "retention",
    requirements: [{ metric: "retention", op: ">=", value: 0.58 }],
    rarity: "rare"
  },
  {
    id: "badge_transfer_climber",
    title: "Transfer Climber",
    description: "Build transfer skill instead of recognition-only recall.",
    category: "depth",
    requirements: [{ metric: "transfer", op: ">=", value: 0.5 }],
    rarity: "rare"
  },
  {
    id: "badge_screen_efficient",
    title: "Screen Efficient",
    description: "Earn graph progress through bounded video and recall gates.",
    category: "screen_efficiency",
    requirements: [{ metric: "screen_efficiency", op: ">=", value: 0.55 }],
    rarity: "rare"
  },
  {
    id: "badge_walk_recaller",
    title: "Walk Recall",
    description: "Complete audio-first walking recall with scored answers.",
    category: "voice",
    requirements: [{ metric: "walk_recall", op: ">=", value: 0.62 }],
    rarity: "rare"
  },
  {
    id: "badge_sleep_guardian",
    title: "Sleep Guardian",
    description: "Keep night reactivation conservative while measuring cue gain against controls.",
    category: "sleep",
    requirements: [
      { metric: "sleep_integrity", op: ">=", value: 0.86 },
      { metric: "sleep_cue_gain", op: ">=", value: 0.02 }
    ],
    rarity: "epic"
  },
  {
    id: "badge_creator_quality",
    title: "Creator Quality",
    description: "Contribute accepted, evidence-backed content through Content Court.",
    category: "creator",
    requirements: [{ metric: "contribution_quality", op: ">=", value: 0.5 }],
    rarity: "epic"
  }
];

export function createChallenge(input: {
  creator: User;
  title: string;
  challengeType: ChallengeType;
  participantIds?: string[];
  shareLevel?: Exclude<ShareLevel, "private">;
  evidenceByUser: Map<string, SocialEvidence>;
  endsAt?: string;
}): SocialChallenge {
  const participantIds = Array.from(new Set([input.creator.id, ...(input.participantIds ?? [])]));
  const challenge: SocialChallenge = {
    id: createId("challenge", `${input.creator.id}:${input.challengeType}:${input.title}`),
    creator_id: input.creator.id,
    title: input.title,
    challenge_type: input.challengeType,
    participant_ids: participantIds,
    share_level: input.shareLevel ?? "friends",
    scoring_metric: challengeMetricByType[input.challengeType],
    anti_gaming_policy: socialGuardrails.slice(0, 3),
    status: participantIds.length > 1 ? "active" : "open",
    scoreboard: [],
    created_at: nowIso(),
    ends_at: input.endsAt
  };
  return scoreChallenge(challenge, input.evidenceByUser);
}

export function scoreChallenge(
  challenge: SocialChallenge,
  evidenceByUser: Map<string, SocialEvidence>
): SocialChallenge {
  const scoreboard = challenge.participant_ids
    .map((userId) => {
      const evidence = evidenceByUser.get(userId);
      if (!evidence) return undefined;
      const metrics = computeOutcomeMetrics(evidence);
      return {
        user_id: userId,
        display_name: visibleDisplayName(evidence.user, challenge.share_level),
        score: round(metrics[challenge.scoring_metric] * 100, 1),
        rank: 0,
        evidence: evidenceLinesFor(challenge.scoring_metric, metrics)
      };
    })
    .filter((score): score is ChallengeScore => Boolean(score))
    .sort((left, right) => right.score - left.score)
    .map((score, index) => ({ ...score, rank: index + 1 }));
  return { ...challenge, scoreboard };
}

export function evaluateBadges(input: {
  userId: string;
  templates?: BadgeTemplate[];
  evidence: SocialEvidence;
  awardedAt?: string;
}): AwardedBadge[] {
  const metrics = computeOutcomeMetrics(input.evidence);
  const templates = input.templates ?? outcomeBadgeTemplates;
  return templates
    .filter((template) => requirementsPass(template, metrics))
    .map((template) => ({
      id: createId("badge_award", `${input.userId}:${template.id}`),
      user_id: input.userId,
      badge_id: template.id,
      title: template.title,
      category: template.category,
      rarity: template.rarity,
      awarded_at: input.awardedAt ?? nowIso(),
      score: round(requirementScore(template, metrics), 3),
      evidence: template.requirements.map((requirement) => {
        const metric = stringField(requirement.metric, "unknown");
        return `${metric}: ${round(metrics[metric as OutcomeMetricKey] ?? 0, 3)}`;
      })
    }));
}

export function computeContributorReputation(evidence: SocialEvidence): ContributorReputation {
  const creatorProposals = evidence.proposals.filter(
    (proposal) => proposal.proposer_id === evidence.user.id || proposal.proposer_id === "ai_agent"
  );
  const accepted = creatorProposals.filter((proposal) =>
    ["accepted", "accepted_with_modifications", "merged"].includes(proposal.status)
  );
  const merged = creatorProposals.filter((proposal) => proposal.status === "merged");
  const disputed = creatorProposals.filter((proposal) =>
    ["disputed", "rejected", "reverted"].includes(proposal.status)
  );
  const evidenceQuality = average(
    creatorProposals.flatMap((proposal) => proposal.evidence_for.map((source) => source.quality_score))
  );
  const outcomePositive = merged.filter((proposal) =>
    String(proposal.expected_learning_impact ?? "").match(/\+|improve|gain|transfer|retention/i)
  );
  const reputationScore = clamp(
    accepted.length * 0.14 +
      merged.length * 0.18 +
      outcomePositive.length * 0.12 +
      evidenceQuality * 0.28 +
      evidence.creatorSubmissionCount * 0.03 -
      disputed.length * 0.18
  );
  return {
    user_id: evidence.user.id,
    accepted_contributions: accepted.length,
    merged_contributions: merged.length,
    outcome_positive_contributions: outcomePositive.length,
    disputed_contributions: disputed.length,
    evidence_quality: round(evidenceQuality, 3),
    reputation_score: round(reputationScore, 3),
    moderation_queue_priority:
      reputationScore >= 0.68
        ? "trusted_fast_track"
        : disputed.length > accepted.length
          ? "needs_review"
          : "normal"
  };
}

export function buildSocialDashboard(input: {
  evidence: SocialEvidence;
  challenges?: SocialChallenge[];
  badgeTemplates?: BadgeTemplate[];
  generatedAt?: string;
}): SocialDashboard {
  const metrics = computeOutcomeMetrics(input.evidence);
  const badges = evaluateBadges({
    userId: input.evidence.user.id,
    templates: input.badgeTemplates,
    evidence: input.evidence,
    awardedAt: input.generatedAt
  });
  const shareLevel = shareLevelFor(input.evidence.user);
  const visibleChallenges = (input.challenges ?? []).filter((challenge) =>
    challenge.participant_ids.includes(input.evidence.user.id)
  );
  return {
    user_id: input.evidence.user.id,
    share_level: shareLevel,
    public_profile: {
      handle: shareLevel === "private" ? "private" : input.evidence.user.handle,
      display_name: visibleDisplayName(input.evidence.user, shareLevel),
      visible_badge_count: shareLevel === "private" ? 0 : badges.length,
      visible_challenge_count: shareLevel === "private" ? 0 : visibleChallenges.length
    },
    outcome_metrics: metrics,
    badges: shareLevel === "private" ? [] : badges,
    challenges: shareLevel === "private" ? [] : visibleChallenges,
    contributor_reputation: computeContributorReputation(input.evidence),
    guardrails: socialGuardrails,
    generated_at: input.generatedAt ?? nowIso()
  };
}

export function computeOutcomeMetrics(evidence: SocialEvidence): Record<OutcomeMetricKey, number> {
  const videoEvents = evidence.events.filter((event) => event.event_type === "video_watched");
  const walkEvents = evidence.events.filter((event) => event.event_type === "walk_recall_completed");
  const sleepRecallEvents = evidence.events.filter(
    (event) => event.event_type === "graph_updated" && event.payload.action === "sleep_cue_recall_completed"
  );
  const sleepPlaybackEvents = evidence.events.filter((event) => event.event_type === "sleep_cue_played");
  const retention = average(evidence.states.map((state) => state.recall_strength));
  const transfer = average(evidence.states.map((state) => state.transfer_score));
  const outcomeDates = new Set(
    evidence.events
      .filter((event) =>
        ["assessment_answered", "graph_updated", "walk_recall_completed", "paced_read_completed"].includes(
          event.event_type
        )
      )
      .map((event) => event.created_at.slice(0, 10))
  );
  const videoRecallPassed = videoEvents.filter((event) => event.payload.recall_passed === true).length;
  const videoMinutes = videoEvents.reduce(
    (sum, event) => sum + numberField(event.payload.screen_minutes, 0),
    0
  );
  const screenEfficiencyFromEvents =
    videoEvents.length > 0
      ? clamp((videoRecallPassed / Math.max(videoEvents.length, 1)) * (1 - videoMinutes / 240))
      : 0;
  const screenEfficiencyFromStates = average(
    evidence.states
      .map((state) => numberOrUndefined(state.modality_response_profile.video_screen_efficiency))
      .filter((value): value is number => value !== undefined)
  );
  const walkRecall = average(walkEvents.map((event) => numberField(event.payload.average_correctness, 0)));
  const sleepCueGain = average(
    sleepRecallEvents.map((event) => numberField(event.payload.cue_gain_delta, 0))
  );
  const disruptions = sleepPlaybackEvents.filter(
    (event) => event.payload.sleep_disruption_reported === true
  ).length;
  const sleepIntegrity = clamp(0.9 + Math.max(0, sleepCueGain) * 0.25 - disruptions * 0.18);
  const reputation = computeContributorReputation(evidence);
  return {
    retention: round(retention, 3),
    transfer: round(transfer, 3),
    consistency: round(clamp(outcomeDates.size / 7), 3),
    screen_efficiency: round(Math.max(screenEfficiencyFromEvents, screenEfficiencyFromStates), 3),
    walk_recall: round(walkRecall, 3),
    sleep_integrity: round(sleepIntegrity, 3),
    sleep_cue_gain: round(sleepCueGain, 3),
    contribution_quality: reputation.reputation_score
  };
}

function requirementsPass(template: BadgeTemplate, metrics: Record<OutcomeMetricKey, number>): boolean {
  return template.requirements.every((requirement) => {
    const metric = stringField(requirement.metric, "");
    const op = stringField(requirement.op, ">=");
    const expected = numberField(requirement.value, 0);
    const actual = metrics[metric as OutcomeMetricKey] ?? 0;
    if (op === ">") return actual > expected;
    if (op === ">=") return actual >= expected;
    if (op === "<") return actual < expected;
    if (op === "<=") return actual <= expected;
    if (op === "==") return actual === expected;
    return false;
  });
}

function requirementScore(template: BadgeTemplate, metrics: Record<OutcomeMetricKey, number>): number {
  return average(
    template.requirements.map((requirement) => {
      const metric = stringField(requirement.metric, "");
      const expected = Math.max(numberField(requirement.value, 1), 0.001);
      return clamp((metrics[metric as OutcomeMetricKey] ?? 0) / expected);
    })
  );
}

function evidenceLinesFor(metric: OutcomeMetricKey, metrics: Record<OutcomeMetricKey, number>): string[] {
  if (metric === "screen_efficiency") {
    return [`recall-gated screen efficiency ${round(metrics.screen_efficiency * 100)}%`];
  }
  if (metric === "sleep_cue_gain")
    return [`cue gain over matched controls ${round(metrics.sleep_cue_gain * 100)} pts`];
  if (metric === "contribution_quality")
    return [`contribution quality ${round(metrics.contribution_quality * 100)}%`];
  return [`${metric.replaceAll("_", " ")} ${round(metrics[metric] * 100)}%`];
}

function shareLevelFor(user: User): ShareLevel {
  const value = user.social_settings.share_level;
  return value === "badges_only" || value === "friends" || value === "public" ? value : "private";
}

function visibleDisplayName(user: User, shareLevel: ShareLevel): string {
  if (shareLevel === "private") return "Private learner";
  if (shareLevel === "badges_only") return user.handle;
  return user.display_name;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
