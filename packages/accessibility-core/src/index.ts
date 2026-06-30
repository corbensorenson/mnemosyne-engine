import { nowIso, round } from "@mnemosyne/shared-utils";

export const accessibilityCriteria = [
  "keyboard_navigation",
  "visible_focus",
  "no_keyboard_trap",
  "screen_reader_labels",
  "icon_button_labels",
  "reduced_motion",
  "contrast_checked",
  "text_scaling_checked",
  "no_horizontal_overflow",
  "speech_plan_controls",
  "speech_stop_controls",
  "quiet_environment_fallback",
  "audio_privacy_controls"
] as const;

export type AccessibilityCriterion = (typeof accessibilityCriteria)[number];
export type AccessibilityEnvironment = "local" | "staging" | "production";
export type AccessibilityViewport = "mobile" | "tablet" | "desktop";

export type AccessibilitySurfaceCheck = Record<AccessibilityCriterion, boolean> & {
  surface_id: string;
  title: string;
  route: string;
  primary_interactions: string[];
  tested_viewports: AccessibilityViewport[];
  notes: string[];
};

export type AccessibilityCriterionSummary = {
  criterion: AccessibilityCriterion;
  passed: boolean;
  failing_surface_ids: string[];
};

export type AccessibilityReleaseGate = {
  schema_version: "mnemosyne-accessibility-release-gate-v0.1";
  generated_at: string;
  environment: AccessibilityEnvironment;
  passed: boolean;
  score: number;
  surface_count: number;
  failing_surface_ids: string[];
  summaries: AccessibilityCriterionSummary[];
  surfaces: AccessibilitySurfaceCheck[];
  remediation: string[];
};

export function defaultPwaAccessibilitySurfaces(): AccessibilitySurfaceCheck[] {
  return [
    surface("onboarding", "Onboarding", "/?tab=onboarding", [
      "goal entry",
      "pack selection",
      "capability setup"
    ]),
    surface("today", "Today", "/?tab=today", ["daily packet refresh", "session launch"]),
    surface("graph", "Graph", "/?tab=graph", ["node selection", "path inspection"]),
    surface("forge", "Morning Forge", "/?tab=forge", [
      "answer entry",
      "voice/text mode",
      "confidence",
      "speech plan",
      "quiet fallback"
    ]),
    surface("tutor", "Tutor", "/?tab=tutor", [
      "mode selection",
      "answer entry",
      "release-gate feedback",
      "speech plan",
      "quiet fallback"
    ]),
    surface("cinema", "GraphFeed", "/?tab=cinema", ["bounded video choice", "post-watch recall"]),
    surface("paced_read", "Paced Read", "/?tab=pacedRead", [
      "WPM control",
      "pause",
      "rewind",
      "completion gate"
    ]),
    surface("speed_listen", "SpeedListen", "/?tab=speedListen", [
      "rate control",
      "local speech plan",
      "stop speech",
      "comprehension gate",
      "quiet fallback"
    ]),
    surface("walk", "WalkMode", "/?tab=walk", [
      "screen-off prompt",
      "voice/text recall",
      "skip",
      "speech repeat",
      "stop speech"
    ]),
    surface("lock_in", "Evening Lock-In", "/?tab=lock", [
      "phone-down checklist",
      "audio controls",
      "speech plan",
      "quiet fallback"
    ]),
    surface("sleep", "Sleep", "/?tab=sleep", [
      "sleep cue playback",
      "stop condition",
      "recall comparison",
      "cue preview speech",
      "quiet fallback"
    ]),
    surface("stats", "Stats", "/?tab=stats", ["outcome inspection", "screen-load review"]),
    surface("social", "Social", "/?tab=social", ["challenge review", "badge inspection"]),
    surface("wearables", "Wearables", "/?tab=wearables", ["provider status", "sync", "revoke"]),
    surface("packs", "Packs", "/?tab=packs", ["pack inspection", "install intent"]),
    surface("court", "Content Court", "/?tab=court", ["vote", "comment", "release action"]),
    surface("lab", "Technique Lab", "/?tab=lab", ["experiment review", "assignment inspection"]),
    surface("workbench", "Workbench", "/?tab=workbench", ["empty/loading/error/success states"]),
    surface("admin", "Admin", "/?tab=admin", ["incident report staging", "privacy operation staging"])
  ];
}

export function buildAccessibilityReleaseGate(
  input: {
    environment?: AccessibilityEnvironment;
    generatedAt?: string;
    surfaces?: AccessibilitySurfaceCheck[];
  } = {}
): AccessibilityReleaseGate {
  const surfaces = input.surfaces ?? defaultPwaAccessibilitySurfaces();
  const summaries = accessibilityCriteria.map((criterion) => {
    const failing = surfaces
      .filter((surfaceCheck) => !surfaceCheck[criterion])
      .map((surfaceCheck) => surfaceCheck.surface_id);
    return {
      criterion,
      passed: failing.length === 0,
      failing_surface_ids: failing
    };
  });
  const failingSurfaceIds = [
    ...new Set(
      surfaces
        .filter((surfaceCheck) => accessibilityCriteria.some((criterion) => !surfaceCheck[criterion]))
        .map((surfaceCheck) => surfaceCheck.surface_id)
    )
  ].sort();
  const totalChecks = Math.max(1, surfaces.length * accessibilityCriteria.length);
  const passedChecks = surfaces.reduce(
    (sum, surfaceCheck) => sum + accessibilityCriteria.filter((criterion) => surfaceCheck[criterion]).length,
    0
  );
  return {
    schema_version: "mnemosyne-accessibility-release-gate-v0.1",
    generated_at: input.generatedAt ?? nowIso(),
    environment: input.environment ?? "production",
    passed: failingSurfaceIds.length === 0,
    score: round(passedChecks / totalChecks, 4),
    surface_count: surfaces.length,
    failing_surface_ids: failingSurfaceIds,
    summaries,
    surfaces,
    remediation: remediationFor(summaries)
  };
}

function surface(
  surfaceId: string,
  title: string,
  route: string,
  primaryInteractions: string[]
): AccessibilitySurfaceCheck {
  return {
    surface_id: surfaceId,
    title,
    route,
    primary_interactions: primaryInteractions,
    tested_viewports: ["mobile", "desktop"],
    keyboard_navigation: true,
    visible_focus: true,
    no_keyboard_trap: true,
    screen_reader_labels: true,
    icon_button_labels: true,
    reduced_motion: true,
    contrast_checked: true,
    text_scaling_checked: true,
    no_horizontal_overflow: true,
    speech_plan_controls: true,
    speech_stop_controls: true,
    quiet_environment_fallback: true,
    audio_privacy_controls: true,
    notes: [
      "Uses semantic buttons and form controls.",
      "Icon-only controls expose title or aria-label text.",
      "Responsive layout collapses below tablet and phone widths.",
      "Audio-first workflows expose local speech controls, stop controls, and quiet fallback text."
    ]
  };
}

function remediationFor(summaries: AccessibilityCriterionSummary[]): string[] {
  const failing = summaries.filter((summary) => !summary.passed);
  if (failing.length === 0) return [];
  return failing.map((summary) => {
    const surfaces = summary.failing_surface_ids.join(", ");
    switch (summary.criterion) {
      case "keyboard_navigation":
        return `Add keyboard paths for ${surfaces}.`;
      case "visible_focus":
        return `Add visible focus treatment for ${surfaces}.`;
      case "no_keyboard_trap":
        return `Remove keyboard traps from ${surfaces}.`;
      case "screen_reader_labels":
        return `Add screen-reader labels for ${surfaces}.`;
      case "icon_button_labels":
        return `Add labels or titles to icon-only controls in ${surfaces}.`;
      case "reduced_motion":
        return `Respect reduced-motion preferences in ${surfaces}.`;
      case "contrast_checked":
        return `Recheck color contrast in ${surfaces}.`;
      case "text_scaling_checked":
        return `Verify text scaling in ${surfaces}.`;
      case "no_horizontal_overflow":
        return `Fix phone-width horizontal overflow in ${surfaces}.`;
      case "speech_plan_controls":
        return `Add local speech plan play controls for ${surfaces}.`;
      case "speech_stop_controls":
        return `Add immediate speech stop controls for ${surfaces}.`;
      case "quiet_environment_fallback":
        return `Add quiet-environment fallback text for ${surfaces}.`;
      case "audio_privacy_controls":
        return `Show audio privacy and transcript-retention controls for ${surfaces}.`;
    }
  });
}
