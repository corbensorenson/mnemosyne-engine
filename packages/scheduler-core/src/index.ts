import { generateAssessmentForConcept } from "@mnemosyne/assessment-core";
import {
  computeGoalGap,
  selectFrontierConcepts,
  selectHorizonConcepts,
  selectKnownDueForReview
} from "@mnemosyne/graph-core";
import type {
  AudioPlan,
  DailyLearningPacket,
  Goal,
  MasterGraph,
  ReadinessProfile,
  User,
  UserKnowledgeGraph,
  WalkPacket
} from "@mnemosyne/schema";
import { createId, nowIso, todayIsoDate, unique } from "@mnemosyne/shared-utils";
import { buildSleepCuePacket } from "@mnemosyne/sleep-core";
import { buildWatchPackets, rankVideosForUser } from "@mnemosyne/video-core";

export type SessionConstraints = {
  morningScreenBudget: number;
  optionalWatchBudgets: number[];
  eveningScreenPolicy?: "audio_only" | "minimal_visual" | "visual_required";
  conservativeSleep?: boolean;
};

export type ScheduledDay = {
  packet: DailyLearningPacket;
  audioPlan: AudioPlan;
};

export function buildDailyLearningPacket(input: {
  user: User;
  userGraph: UserKnowledgeGraph;
  masterGraph: MasterGraph;
  goals: Goal[];
  readiness: ReadinessProfile;
  constraints: SessionConstraints;
}): ScheduledDay {
  const goalGap = computeGoalGap(input.userGraph, input.masterGraph, input.goals);
  const knownIds = selectKnownDueForReview(input.userGraph, goalGap, 8);
  const frontier = selectFrontierConcepts(input.userGraph, input.masterGraph, goalGap, 8);
  const horizon = selectHorizonConcepts(input.userGraph, input.masterGraph, frontier, input.goals, 5);
  const frontierIds = frontier.map((concept) => concept.id);
  const horizonIds = horizon.map((concept) => concept.id);

  const coldRetrievalItems = knownIds
    .map((id) => input.masterGraph.concepts.find((concept) => concept.id === id))
    .filter(Boolean)
    .map((concept) => generateAssessmentForConcept(concept!, "free_recall"));
  const transferDrills = frontier
    .slice(0, 4)
    .map((concept) => generateAssessmentForConcept(concept, "transfer"));

  const rankedVideos = rankVideosForUser({
    videos: input.masterGraph.videos,
    states: input.userGraph.states,
    goals: input.goals,
    frontierConceptIds: frontierIds,
    horizonConceptIds: horizonIds,
    readiness: input.readiness
  });

  const watchPackets = buildWatchPackets({
    user: input.user,
    rankedVideos,
    timeBudgets: input.constraints.optionalWatchBudgets,
    frontierConceptIds: frontierIds,
    horizonConceptIds: horizonIds
  });

  const walkPackets = buildWalkPackets({
    userId: input.user.id,
    targetConceptIds: unique([...knownIds.slice(0, 3), ...frontierIds.slice(0, 4)]),
    prompts: [...coldRetrievalItems.slice(0, 4), ...transferDrills.slice(0, 2)]
  });

  const sleep = buildSleepCuePacket({
    user: input.user,
    concepts: input.masterGraph.concepts,
    states: input.userGraph.states,
    knownIds,
    frontierIds,
    horizonIds,
    readiness: input.readiness,
    conservative: input.constraints.conservativeSleep
  });

  const packet: DailyLearningPacket = {
    id: createId("daily_packet", `${input.user.id}:${todayIsoDate()}`),
    user_id: input.user.id,
    date: todayIsoDate(),
    readiness_profile: input.readiness,
    morning: {
      cold_retrieval_items: coldRetrievalItems.slice(0, 6),
      error_repair_items: input.userGraph.states
        .filter((state) => state.false_confidence_risk > 0.55 || state.times_failed > 1)
        .slice(0, 4)
        .map((state) => state.concept_id),
      frontier_items: frontier.slice(0, 5),
      horizon_items: horizon.slice(0, 3),
      cue_preview_items: frontier.flatMap((concept) => concept.sleep_cues).slice(0, 4),
      recommended_mode: input.readiness.voice_ok
        ? input.constraints.morningScreenBudget <= 5
          ? "walk"
          : "audio_visual"
        : "desk"
    },
    optional_watch_packets: watchPackets,
    walk_packets: walkPackets,
    evening: {
      recall_items: coldRetrievalItems.slice(0, 4),
      interleaved_review_items: knownIds
        .slice(2, 6)
        .map((id) => input.masterGraph.concepts.find((concept) => concept.id === id))
        .filter(Boolean)
        .map((concept) => generateAssessmentForConcept(concept!, "short_answer")),
      transfer_drills: transferDrills,
      failure_map_updates: input.userGraph.states
        .flatMap((state) => state.failure_modes)
        .filter((failure) => failure !== "none")
        .slice(0, 6),
      sleep_cue_binding_items: frontier.flatMap((concept) => concept.sleep_cues).slice(0, 6),
      screen_policy: input.constraints.eveningScreenPolicy ?? (input.readiness.dusk_mode ? "audio_only" : "minimal_visual")
    },
    sleep: sleep.packet,
    graph_delta_target: {
      known_review_count: knownIds.length,
      frontier_push_count: frontier.length,
      horizon_preview_count: horizon.length,
      prerequisite_debt_reduction_target: Math.min(0.12, goalGap.prerequisiteDebt * 0.3),
      expected_durable_mastery_gain: Number((frontier.length * 0.08 + knownIds.length * 0.025).toFixed(2)),
      screen_budget_minutes: input.readiness.screen_budget_minutes
    },
    created_at: nowIso()
  };

  return { packet, audioPlan: sleep.audioPlan };
}

function buildWalkPackets(input: {
  userId: string;
  targetConceptIds: string[];
  prompts: ReturnType<typeof generateAssessmentForConcept>[];
}): WalkPacket[] {
  return [
    {
      id: createId("walk_packet", `${input.userId}:${todayIsoDate()}`),
      user_id: input.userId,
      target_concept_ids: input.targetConceptIds,
      prompts: input.prompts,
      voice_commands: [
        "repeat that",
        "slower",
        "harder",
        "give hint",
        "skip",
        "mark confusing",
        "explain why",
        "screen off",
        "end session"
      ],
      screen_policy: "screen_locked",
      created_at: nowIso()
    }
  ];
}
