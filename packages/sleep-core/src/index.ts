import { createNightAudioPlan } from "@mnemosyne/audio-core";
import type {
  AudioPlan,
  ConceptNode,
  ReadinessProfile,
  SleepCuePacket,
  SleepCueTemplate,
  User,
  UserConceptState
} from "@mnemosyne/schema";
import { createId, nowIso, sortByScore, todayIsoDate } from "@mnemosyne/shared-utils";

export type SleepBuildResult = {
  packet: SleepCuePacket;
  audioPlan: AudioPlan;
  cues: SleepCueTemplate[];
};

export function buildSleepCuePacket(input: {
  user: User;
  concepts: ConceptNode[];
  states: UserConceptState[];
  knownIds: string[];
  frontierIds: string[];
  horizonIds: string[];
  readiness: ReadinessProfile;
  conservative?: boolean;
}): SleepBuildResult {
  const cueMap = new Map<string, SleepCueTemplate>();
  for (const concept of input.concepts) {
    for (const cue of concept.sleep_cues) {
      if (isSleepSafeCue(cue)) cueMap.set(cue.id, cue);
    }
  }

  const safeCues = [...cueMap.values()];
  const ratio = input.conservative
    ? { reactivate: 0.7, stabilize: 0.25, prime: 0.05 }
    : { reactivate: 0.65, stabilize: 0.3, prime: 0.05 };
  const totalCueSlots = input.readiness.sleep_quality < 0.45 ? 8 : 18;
  const reactivate = pickConcepts(input.knownIds, safeCues, Math.ceil(totalCueSlots * ratio.reactivate));
  const stabilize = pickConcepts(input.frontierIds, safeCues, Math.ceil(totalCueSlots * ratio.stabilize));
  const prime = pickConcepts(
    input.horizonIds,
    safeCues,
    Math.max(1, Math.floor(totalCueSlots * ratio.prime))
  );
  const control = matchedControls(input.concepts, input.states, [...reactivate, ...stabilize, ...prime], 4);

  const selectedCues = [...reactivate, ...stabilize, ...prime, ...control]
    .map((conceptId) => safeCues.find((cue) => cue.concept_id === conceptId))
    .filter((cue): cue is SleepCueTemplate => Boolean(cue));

  const spacing = input.readiness.sleep_quality < 0.45 ? 240 : 135;
  const maxVolume = input.readiness.fatigue > 0.7 ? 0.2 : 0.28;
  const audioPlan = createNightAudioPlan({
    userId: input.user.id,
    cues: [
      ...selectedCues
        .filter((cue) => reactivate.includes(cue.concept_id))
        .map((cue) => ({ cue, label: cue.text ?? cue.id, bucket: "reactivate" as const })),
      ...selectedCues
        .filter((cue) => stabilize.includes(cue.concept_id))
        .map((cue) => ({ cue, label: cue.text ?? cue.id, bucket: "stabilize" as const })),
      ...selectedCues
        .filter((cue) => prime.includes(cue.concept_id))
        .map((cue) => ({ cue, label: cue.text ?? cue.id, bucket: "prime" as const })),
      ...selectedCues
        .filter((cue) => control.includes(cue.concept_id))
        .map((cue) => ({ cue, label: cue.text ?? cue.id, bucket: "control" as const }))
    ],
    cueSpacingSeconds: spacing,
    cueStartDelayMinutes: input.readiness.fatigue > 0.7 ? 50 : 35,
    maxVolume
  });

  const packet: SleepCuePacket = {
    id: createId("sleep_packet"),
    user_id: input.user.id,
    night_date: todayIsoDate(),
    target_sleep_window: {
      estimated_sleep_onset_at: new Date(Date.now() + 90 * 60_000).toISOString(),
      cue_start_delay_minutes: input.readiness.fatigue > 0.7 ? 50 : 35,
      cue_end_before_wake_minutes: 35
    },
    audio_plan_id: audioPlan.id,
    reactivate_concept_ids: reactivate,
    stabilize_concept_ids: stabilize,
    prime_concept_ids: prime,
    control_concept_ids: control,
    cue_spacing_seconds: spacing,
    max_cues_per_hour: spacing >= 240 ? 10 : 22,
    max_volume: maxVolume,
    stop_conditions: {
      movement_detected: true,
      user_wake_report: true,
      wearable_wake_signal: true,
      time_limit: true
    },
    experiment_assignments: [
      {
        id: createId("experiment_assignment", `${input.user.id}:sleep-cue`),
        design: "within_user_matched_controls",
        cued: [...reactivate, ...stabilize, ...prime],
        control
      }
    ],
    created_at: nowIso()
  };

  return { packet, audioPlan, cues: selectedCues };
}

export function isSleepSafeCue(cue: SleepCueTemplate): boolean {
  return (
    cue.status !== "avoid" &&
    cue.sleep_safety_score >= 0.72 &&
    cue.cross_talk_risk <= 0.55 &&
    cue.emotional_activation_score <= 0.42 &&
    cue.duration_ms <= 5000
  );
}

function pickConcepts(conceptIds: string[], cues: SleepCueTemplate[], count: number): string[] {
  const allowed = new Set(conceptIds);
  return sortByScore(
    cues.filter((cue) => allowed.has(cue.concept_id)),
    (cue) => cue.sleep_safety_score + cue.cue_specificity - cue.cross_talk_risk
  )
    .slice(0, count)
    .map((cue) => cue.concept_id);
}

function matchedControls(
  concepts: ConceptNode[],
  states: UserConceptState[],
  excludedConceptIds: string[],
  count: number
): string[] {
  const excluded = new Set(excludedConceptIds);
  return sortByScore(
    concepts.filter((concept) => {
      const hasState = states.some((state) => state.concept_id === concept.id);
      return hasState && !excluded.has(concept.id) && concept.sleep_cues.some(isSleepSafeCue);
    }),
    (concept) => concept.importance - concept.difficulty * 0.1
  )
    .slice(0, count)
    .map((concept) => concept.id);
}
