import type {
  Goal,
  ReadinessProfile,
  User,
  UserConceptState,
  VideoAsset,
  WatchPacket
} from "@mnemosyne/schema";
import { clamp, createId, nowIso, sortByScore, unique } from "@mnemosyne/shared-utils";

export type RankedVideo = {
  video: VideoAsset;
  score: number;
  reasons: string[];
};

export function rankVideosForUser(input: {
  videos: VideoAsset[];
  states: UserConceptState[];
  goals: Goal[];
  frontierConceptIds: string[];
  horizonConceptIds: string[];
  readiness: ReadinessProfile;
}): RankedVideo[] {
  const targetDomains = new Set(input.goals.flatMap((goal) => goal.target_domain_ids));
  return sortByScore(
    input.videos
      .filter((video) => video.status !== "rejected" && video.status !== "deprecated" && video.embeddable)
      .map((video) => {
        const conceptFit = overlap(video.concept_ids, input.frontierConceptIds);
        const horizonFit = overlap(video.horizon_concept_ids, input.horizonConceptIds);
        const prereqFit = prerequisiteFit(video, input.states);
        const goalFit = video.concept_ids.some((id) => targetDomains.has(id.split("_")[0])) ? 0.15 : 0;
        const timeFit =
          video.duration_seconds / 60 <= Math.max(5, input.readiness.screen_budget_minutes) ? 1 : 0.4;
        const sleepPenalty = input.readiness.dusk_mode ? video.cognitive_load_score * 0.18 : 0;
        const score = clamp(
          conceptFit * 0.22 +
            horizonFit * 0.1 +
            prereqFit * 0.12 +
            video.source_quality_score * 0.14 +
            video.retention_lift_score * 0.14 +
            video.transfer_lift_score * 0.1 +
            video.screen_efficiency_score * 0.12 +
            video.entertainment_score * 0.04 +
            timeFit * 0.08 +
            goalFit -
            video.misinformation_risk * 0.18 -
            video.sponsor_noise_score * 0.08 -
            sleepPenalty
        );
        return {
          video,
          score,
          reasons: reasonsFor(video, conceptFit, horizonFit, prereqFit, timeFit)
        };
      }),
    (ranked) => ranked.score
  );
}

export function buildWatchPackets(input: {
  user: User;
  rankedVideos: RankedVideo[];
  timeBudgets: number[];
  frontierConceptIds: string[];
  horizonConceptIds: string[];
}): WatchPacket[] {
  return input.timeBudgets.slice(0, 3).map((budget, index) => {
    const purpose: WatchPacket["purpose"] = index === 0 ? "deepen" : index === 1 ? "rabbit_hole" : "preview";
    const selected = boundedVideoSelection(input.rankedVideos, budget, purpose);
    const targetConceptIds = unique(selected.flatMap((ranked) => ranked.video.concept_ids)).slice(0, 8);
    return {
      id: createId("watch_packet", `${input.user.id}:${purpose}:${budget}`),
      user_id: input.user.id,
      purpose,
      total_time_budget_minutes: budget,
      video_ids: selected.map((ranked) => ranked.video.id),
      target_concept_ids: targetConceptIds,
      expected_graph_effect: {
        retention_lift: selected.reduce((sum, ranked) => sum + ranked.video.retention_lift_score, 0),
        transfer_lift: selected.reduce((sum, ranked) => sum + ranked.video.transfer_lift_score, 0),
        screen_load_multiplier: selected.length > 0 ? 0.42 : 0.8,
        packet_boundary: true
      },
      required_post_watch_recall: true,
      suggested_next_mode: purpose === "preview" ? "stop" : "walk_recall",
      created_at: nowIso()
    };
  });
}

export function boundedVideoSelection(
  rankedVideos: RankedVideo[],
  budgetMinutes: number,
  purpose: WatchPacket["purpose"]
): RankedVideo[] {
  const maxSeconds = budgetMinutes * 60;
  const selected: RankedVideo[] = [];
  let used = 0;
  const candidates = rankedVideos.filter((ranked) =>
    purpose === "preview"
      ? ranked.video.difficulty <= 0.65
      : purpose === "rabbit_hole"
        ? ranked.video.entertainment_score >= 0.5
        : ranked.score >= 0.45
  );
  for (const ranked of candidates) {
    if (used + ranked.video.duration_seconds > maxSeconds) continue;
    selected.push(ranked);
    used += ranked.video.duration_seconds;
    if (selected.length >= 3) break;
  }
  return selected;
}

function prerequisiteFit(video: VideoAsset, states: UserConceptState[]): number {
  if (video.prerequisite_concept_ids.length === 0) return 1;
  return (
    video.prerequisite_concept_ids.reduce((sum, id) => {
      const state = states.find((candidate) => candidate.concept_id === id);
      return sum + (state?.mastery ?? 0);
    }, 0) / video.prerequisite_concept_ids.length
  );
}

function overlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length / Math.max(left.length, right.length);
}

function reasonsFor(
  video: VideoAsset,
  conceptFit: number,
  horizonFit: number,
  prereqFit: number,
  timeFit: number
): string[] {
  const reasons: string[] = [];
  if (conceptFit > 0) reasons.push("frontier match");
  if (horizonFit > 0) reasons.push("horizon preview");
  if (prereqFit >= 0.7) reasons.push("prerequisites fit");
  if (video.retention_lift_score >= 0.65) reasons.push("retention lift");
  if (video.screen_efficiency_score >= 0.65) reasons.push("screen efficient");
  if (timeFit >= 1) reasons.push("fits packet");
  return reasons;
}
