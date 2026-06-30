import { describe, expect, it } from "vitest";
import { generateAssessmentForConcept, scoreAssessmentResponse } from "@mnemosyne/assessment-core";
import { demoMasterGraph, demoUser } from "@mnemosyne/demo-fixtures";

describe("assessment scoring", () => {
  it("flags high-confidence wrong answers as false confidence", () => {
    const concept = demoMasterGraph.concepts.find((item) => item.id === "attention_qkv")!;
    const item = generateAssessmentForConcept(concept, "free_recall");
    const response = scoreAssessmentResponse({
      userId: demoUser.id,
      item,
      rawResponse: "attention is when the model memorizes the answer directly",
      confidence: 0.92,
      latencyMs: 9000
    });

    expect(response.detected_failure_modes).toContain("false_confidence");
    expect(response.correctness_score).toBeLessThan(0.45);
  });
});
