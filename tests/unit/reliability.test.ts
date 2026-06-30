import {
  buildReliabilityReleaseGate,
  defaultReliabilityScenarios,
  referenceReliabilityObservations
} from "@mnemosyne/reliability-core";
import { describe, expect, it } from "vitest";

describe("reliability-core", () => {
  it("builds a passing release gate for the first-party production load contract", () => {
    const gate = buildReliabilityReleaseGate({
      environment: "production",
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(gate.schema_version).toBe("mnemosyne-reliability-release-gate-v0.1");
    expect(gate.passed).toBe(true);
    expect(gate.score).toBe(1);
    expect(gate.scenario_count).toBeGreaterThanOrEqual(12);
    expect(gate.failing_scenario_ids).toEqual([]);
    expect(gate.required_scenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "onboarding_to_daily_packet",
        "morning_forge_complete",
        "walk_mode_complete",
        "sleep_audio_render",
        "privacy_export_delete",
        "worker_queue_drain"
      ])
    );
  });

  it("fails with concrete remediation for slow or under-audited observations", () => {
    const scenarios = defaultReliabilityScenarios("production");
    const observations = referenceReliabilityObservations("production", "2026-06-30T12:00:00.000Z").map(
      (observation) =>
        observation.scenario_id === "sleep_audio_render"
          ? {
              ...observation,
              observed_rps: 0.5,
              p95_ms: 4_000,
              p99_ms: 6_000,
              audit_events: 0,
              integrity_checks: 0,
              queue_drain_seconds: 240
            }
          : observation
    );

    const gate = buildReliabilityReleaseGate({ scenarios, observations });

    expect(gate.passed).toBe(false);
    expect(gate.failing_scenario_ids).toEqual(["sleep_audio_render"]);
    expect(gate.evaluations.find((evaluation) => evaluation.scenario_id === "sleep_audio_render")).toEqual(
      expect.objectContaining({
        passed: false,
        checks: expect.objectContaining({
          load_target_met: false,
          p95_latency: false,
          audit_coverage: false,
          integrity_coverage: false,
          queue_drain: false
        })
      })
    );
    expect(gate.remediation.join(" ")).toContain("sleep_audio_render");
  });
});
