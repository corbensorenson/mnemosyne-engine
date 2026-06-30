import type { ConceptType, Experiment, Technique, UserConceptState } from "@mnemosyne/schema";
import { createId, nowIso, sortByScore } from "@mnemosyne/shared-utils";

const allConceptTypes: ConceptType[] = [
  "fact",
  "association",
  "definition",
  "procedure",
  "pattern",
  "model",
  "argument",
  "judgment",
  "motor_adjacent",
  "language_phrase",
  "system"
];

export const techniqueRegistry: Technique[] = [
  makeTechnique(
    "spaced_retrieval",
    "Spaced retrieval",
    "Retrieval scheduled by stability and goal pressure.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "successive_relearning",
    "Successive relearning",
    "Repeated retrieval to criterion across spaced sessions.",
    "spacing",
    "strong"
  ),
  makeTechnique(
    "failure_first",
    "Pretesting",
    "Ask before teaching to expose missing structure.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "generate_mode",
    "Generation effect",
    "Require learner-generated answers before examples.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "explain_back",
    "Self-explanation",
    "Learner explains mechanism, boundary, and example.",
    "retrieval",
    "strong"
  ),
  makeTechnique(
    "compare_mode",
    "Interleaving",
    "Mix near neighbors and contrasting cases.",
    "pattern",
    "strong"
  ),
  makeTechnique(
    "example_fade",
    "Worked-example fading",
    "Step support is gradually removed.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "pattern_forge",
    "Perceptual learning",
    "Rapid classification with feedback for patterns.",
    "pattern",
    "moderate"
  ),
  makeTechnique(
    "smart_video",
    "Educational video segmentation",
    "Video is segmented into active recall objects.",
    "video",
    "moderate"
  ),
  makeTechnique(
    "flashread",
    "FlashRead RSVP",
    "Graph-aware chunked RSVP with comprehension gates.",
    "visual_intake",
    "experimental"
  ),
  makeTechnique(
    "typography_lab",
    "Adaptive typography",
    "Tune font, contrast, spacing, and chunking to outcome.",
    "typography",
    "experimental"
  ),
  makeTechnique(
    "speed_listen",
    "SpeedListen",
    "Time-compressed audio with comprehension and strain checks.",
    "audio_intake",
    "experimental"
  ),
  makeTechnique(
    "shadow_speak",
    "Language shadowing",
    "Immediate oral mimicry with pronunciation feedback.",
    "audio_intake",
    "moderate",
    ["language_phrase"]
  ),
  makeTechnique(
    "memory_palace",
    "Memory palace",
    "Spatial binding for ordered or associative content.",
    "memory",
    "moderate"
  ),
  makeTechnique(
    "sketch_lock",
    "Drawing reconstruction",
    "Rebuild visual or structural knowledge from memory.",
    "embodied",
    "moderate"
  ),
  makeTechnique(
    "map_recall",
    "Retrieval concept mapping",
    "Draw graph neighborhoods from memory.",
    "retrieval",
    "moderate"
  ),
  makeTechnique(
    "gesture_bind",
    "Gesture and haptics",
    "Bind motor or haptic cues to recall objects.",
    "embodied",
    "experimental"
  ),
  makeTechnique(
    "walk_mode",
    "Walking recall",
    "Audio recall while moving with screen locked.",
    "embodied",
    "moderate"
  ),
  makeTechnique(
    "curiosity_engine",
    "Knowledge gaps",
    "Use unresolved gap tension to prioritize retrieval.",
    "gamification",
    "moderate"
  ),
  makeTechnique(
    "sleep_cue",
    "Targeted sleep reactivation",
    "Sparse replay of awake-bound cues with matched controls.",
    "sleep",
    "experimental"
  ),
  makeTechnique(
    "beat_lab",
    "Tonal cue namespaces",
    "Tone families for cue disambiguation.",
    "experimental",
    "speculative"
  ),
  makeTechnique(
    "audio_cue_lab",
    "Music-embedded cues",
    "Embed cues in low-arousal motifs.",
    "experimental",
    "speculative"
  )
];

export function recommendTechniques(input: {
  states: UserConceptState[];
  conceptTypes: ConceptType[];
  avoidDuskActivation?: boolean;
  limit?: number;
}): Technique[] {
  const falseConfidence =
    input.states.filter((state) => state.false_confidence_risk > 0.55).length /
    Math.max(input.states.length, 1);
  const lowTransfer =
    input.states.filter((state) => state.transfer_score < 0.5).length / Math.max(input.states.length, 1);
  return sortByScore(
    techniqueRegistry.filter((technique) =>
      technique.applicable_concept_types.some((conceptType) => input.conceptTypes.includes(conceptType))
    ),
    (technique) => {
      const evidence =
        technique.evidence_level === "strong" ? 0.35 : technique.evidence_level === "moderate" ? 0.22 : 0.1;
      const falseConfidenceFit =
        falseConfidence > 0.25 && ["failure_first", "explain_back", "compare_mode"].includes(technique.id)
          ? 0.25
          : 0;
      const transferFit =
        lowTransfer > 0.3 && ["compare_mode", "example_fade", "sketch_lock"].includes(technique.id) ? 0.2 : 0;
      const duskPenalty =
        input.avoidDuskActivation && ["smart_video", "flashread", "typography_lab"].includes(technique.id)
          ? 0.25
          : 0;
      return evidence + falseConfidenceFit + transferFit - duskPenalty;
    }
  ).slice(0, input.limit ?? 6);
}

export function createTechniqueExperiment(technique: Technique): Experiment {
  return {
    id: createId("experiment", technique.id),
    title: `${technique.name} within-user matched test`,
    experiment_type: "technique",
    hypothesis: `${technique.name} improves 24h recall, 7d recall, transfer, or calibration versus matched controls.`,
    unit_of_randomization: "concept",
    conditions: [
      { id: "technique", technique_id: technique.id },
      { id: "control", technique_id: "standard_retrieval" }
    ],
    assignment_strategy: "within_user_matched",
    metrics: [
      "immediate_recall",
      "recall_24h",
      "recall_7d",
      "transfer_score",
      "answer_latency",
      "confidence_calibration",
      "screen_efficiency",
      "user_preference"
    ],
    status: "draft",
    created_at: nowIso()
  };
}

function makeTechnique(
  id: string,
  name: string,
  description: string,
  category: Technique["category"],
  evidence: Technique["evidence_level"],
  conceptTypes: ConceptType[] = allConceptTypes
): Technique {
  return {
    id,
    name,
    description,
    category,
    applicable_concept_types: conceptTypes,
    contraindications:
      category === "sleep"
        ? ["insomnia flare", "high emotional activation", "unsafe audio environment"]
        : category === "video"
          ? ["dusk mode", "screen budget exhausted"]
          : [],
    required_inputs: ["concept_state", "assessment_history", "goal_context"],
    outputs: ["learning_event", "graph_update", "experiment_observation"],
    default_parameters: { intensity: "adaptive", controls: true },
    user_parameter_overrides: {},
    evidence_level: evidence,
    experiment_design: { assignment: "within_user_matched", control_required: true }
  };
}
