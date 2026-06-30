import {
  accessibilityCriteria,
  buildAccessibilityReleaseGate,
  defaultPwaAccessibilitySurfaces
} from "@mnemosyne/accessibility-core";
import { describe, expect, it } from "vitest";

describe("accessibility-core", () => {
  it("builds a passing release gate for the current PWA surface inventory", () => {
    const gate = buildAccessibilityReleaseGate({
      environment: "production",
      generatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(gate.schema_version).toBe("mnemosyne-accessibility-release-gate-v0.1");
    expect(gate.passed).toBe(true);
    expect(gate.score).toBe(1);
    expect(gate.surface_count).toBeGreaterThanOrEqual(18);
    expect(gate.summaries.map((summary) => summary.criterion)).toEqual([...accessibilityCriteria]);
    expect(gate.surfaces.map((surface) => surface.surface_id)).toEqual(
      expect.arrayContaining([
        "onboarding",
        "forge",
        "tutor",
        "paced_read",
        "walk",
        "sleep",
        "court",
        "admin"
      ])
    );
  });

  it("fails with concrete remediation when a surface misses a required check", () => {
    const surfaces = defaultPwaAccessibilitySurfaces();
    const broken = surfaces.map((surface) =>
      surface.surface_id === "walk"
        ? { ...surface, keyboard_navigation: false, no_horizontal_overflow: false }
        : surface
    );

    const gate = buildAccessibilityReleaseGate({ surfaces: broken });

    expect(gate.passed).toBe(false);
    expect(gate.score).toBeLessThan(1);
    expect(gate.failing_surface_ids).toEqual(["walk"]);
    expect(gate.summaries.find((summary) => summary.criterion === "keyboard_navigation")).toEqual(
      expect.objectContaining({
        passed: false,
        failing_surface_ids: ["walk"]
      })
    );
    expect(gate.remediation).toEqual(
      expect.arrayContaining(["Add keyboard paths for walk.", "Fix phone-width horizontal overflow in walk."])
    );
  });
});
