import { generateAssessmentForConcept } from "@mnemosyne/assessment-core";
import { demoMasterGraph, demoUser } from "@mnemosyne/demo-fixtures";
import {
  buildTutorTurn,
  evaluateTutorOutput,
  evaluateTutorReleaseGate,
  scoreSemanticResponse
} from "@mnemosyne/tutor-core";
import { describe, expect, it } from "vitest";

describe("tutor-core", () => {
  it("scores rubric semantics and detects false confidence without a model API", () => {
    const concept = demoMasterGraph.concepts.find((item) => item.id === "attention_qkv")!;
    const item = generateAssessmentForConcept(concept, "transfer");
    const scored = scoreSemanticResponse({
      item,
      rawResponse: "attention is magic and it always memorizes the direct answer",
      confidence: 0.91,
      latencyMs: 12_000
    });

    expect(scored.correctness_score).toBeLessThan(0.45);
    expect(scored.detected_failure_modes).toContain("false_confidence");
    expect(scored.detected_failure_modes).toContain("shallow_transfer");
    expect(scored.missing_required_terms.length).toBeGreaterThan(0);
  });

  it("builds concise tutor turns with compatible assessment events", () => {
    const concept = demoMasterGraph.concepts.find((item) => item.id === "ai_vectors")!;
    const item = generateAssessmentForConcept(concept, "free_recall");
    const rawResponse = [
      ...item.rubric.must_include,
      item.rubric.acceptable_aliases[0],
      "because",
      "boundary"
    ].join(" ");
    const turn = buildTutorTurn({
      userId: demoUser.id,
      mode: "oral_board",
      item,
      rawResponse,
      confidence: 0.78,
      latencyMs: 14_000,
      createdAt: "2026-06-30T12:00:00.000Z"
    });
    const gate = evaluateTutorReleaseGate([turn]);

    expect(turn.compatible_assessment_event).toBe(true);
    expect(turn.ask_before_teach).toBe(true);
    expect(turn.feedback).not.toContain(item.expected_answer ?? "never-match");
    expect(turn.safety_evaluation.release_gate_passed).toBe(true);
    expect(gate.passed).toBe(true);
  });

  it("flags answer leakage and unsafe high-stakes drafts", () => {
    const concept = demoMasterGraph.concepts.find((item) => item.id === "attention_qkv")!;
    const item = generateAssessmentForConcept(concept, "free_recall");
    const evaluation = evaluateTutorOutput({
      item,
      highStakesDomain: true,
      draft: `${item.expected_answer}. This is guaranteed medical legal advice with dosage.`
    });

    expect(evaluation.flags).toEqual(
      expect.arrayContaining(["answer_leakage", "hallucination_language", "unsafe_high_stakes_advice"])
    );
    expect(evaluation.requires_human_review).toBe(true);
    expect(evaluation.release_gate_passed).toBe(false);
  });
});
