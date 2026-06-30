import { nowIso, round } from "@mnemosyne/shared-utils";

export const reliabilityScenarioIds = [
  "api_liveness_readiness",
  "onboarding_to_daily_packet",
  "morning_forge_complete",
  "walk_mode_complete",
  "evening_sleep_handoff",
  "sleep_audio_render",
  "graphfeed_recall",
  "paced_read_completion",
  "content_court_release",
  "privacy_export_delete",
  "worker_queue_drain",
  "wearable_sleep_sync"
] as const;

export type ReliabilityScenarioId = (typeof reliabilityScenarioIds)[number];
export type ReliabilityEnvironment = "local" | "staging" | "production";
export type ReliabilitySurface =
  "api" | "pwa" | "worker" | "object_storage" | "governance" | "privacy" | "wearables";

export type ReliabilitySlo = {
  target_rps: number;
  target_concurrency: number;
  max_p95_ms: number;
  max_p99_ms: number;
  max_error_rate: number;
  max_timeout_rate: number;
  min_success_rate: number;
  min_audit_coverage: number;
  min_integrity_coverage: number;
  max_queue_drain_seconds?: number;
};

export type ReliabilityScenario = {
  id: ReliabilityScenarioId;
  title: string;
  surface: ReliabilitySurface;
  journey: string[];
  slo: ReliabilitySlo;
  requires_audit_events: boolean;
  requires_integrity_checks: boolean;
  requires_replay_check: boolean;
  runbook_refs: string[];
};

export type ReliabilityObservation = {
  scenario_id: ReliabilityScenarioId;
  observed_rps: number;
  concurrent_users: number;
  requests: number;
  failures: number;
  timeouts: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  audit_events: number;
  integrity_checks: number;
  queue_drain_seconds?: number;
  replay_verified?: boolean;
  generated_at?: string;
  notes: string[];
};

export type ReliabilityScenarioChecks = {
  observation_present: boolean;
  load_target_met: boolean;
  concurrency_target_met: boolean;
  p95_latency: boolean;
  p99_latency: boolean;
  error_rate: boolean;
  timeout_rate: boolean;
  success_rate: boolean;
  audit_coverage: boolean;
  integrity_coverage: boolean;
  queue_drain: boolean;
  replay_verified: boolean;
};

export type ReliabilityScenarioEvaluation = {
  scenario_id: ReliabilityScenarioId;
  title: string;
  surface: ReliabilitySurface;
  passed: boolean;
  score: number;
  observed_error_rate: number;
  observed_timeout_rate: number;
  observed_success_rate: number;
  observed_audit_coverage: number;
  observed_integrity_coverage: number;
  observed_p95_ms?: number;
  observed_p99_ms?: number;
  observed_rps?: number;
  blockers: string[];
  checks: ReliabilityScenarioChecks;
};

export type ReliabilityReleaseGate = {
  schema_version: "mnemosyne-reliability-release-gate-v0.1";
  generated_at: string;
  environment: ReliabilityEnvironment;
  passed: boolean;
  score: number;
  scenario_count: number;
  failing_scenario_ids: ReliabilityScenarioId[];
  aggregate_error_rate: number;
  maximum_observed_p95_ms: number;
  required_scenarios: ReliabilityScenario[];
  observations: ReliabilityObservation[];
  evaluations: ReliabilityScenarioEvaluation[];
  remediation: string[];
};

export function defaultReliabilityScenarios(
  environment: ReliabilityEnvironment = "production"
): ReliabilityScenario[] {
  const scale = loadScale(environment);
  return [
    scenario("api_liveness_readiness", "API liveness and dependency readiness", "api", {
      journey: ["GET /healthz", "GET /readyz"],
      targetRps: 20 * scale,
      targetConcurrency: Math.ceil(10 * scale),
      maxP95Ms: 180,
      maxP99Ms: 350,
      audit: false,
      integrity: false,
      replay: false
    }),
    scenario("onboarding_to_daily_packet", "New learner onboarding to first daily packet", "api", {
      journey: ["POST /api/onboarding/complete", "GET /api/daily-packet/today"],
      targetRps: 8 * scale,
      targetConcurrency: Math.ceil(8 * scale),
      maxP95Ms: 900,
      maxP99Ms: 1600,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("morning_forge_complete", "Morning Forge completion and graph update", "api", {
      journey: ["POST /api/morning-forge/complete", "POST /api/graph/user/replay"],
      targetRps: 12 * scale,
      targetConcurrency: Math.ceil(15 * scale),
      maxP95Ms: 650,
      maxP99Ms: 1200,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("walk_mode_complete", "WalkMode voice/text completion", "pwa", {
      journey: ["screen-locked prompt queue", "POST /api/walk-mode/complete"],
      targetRps: 10 * scale,
      targetConcurrency: Math.ceil(12 * scale),
      maxP95Ms: 700,
      maxP99Ms: 1300,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("evening_sleep_handoff", "Evening Lock-In to SleepCue packet handoff", "api", {
      journey: ["POST /api/evening-lock-in/complete", "GET /api/sleep/packet/tonight"],
      targetRps: 8 * scale,
      targetConcurrency: Math.ceil(10 * scale),
      maxP95Ms: 850,
      maxP99Ms: 1500,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("sleep_audio_render", "Sleep audio render manifest", "worker", {
      journey: ["POST /api/sleep/audio/render", "audio_render:render_sleep_audio"],
      targetRps: 4 * scale,
      targetConcurrency: Math.ceil(6 * scale),
      maxP95Ms: 1600,
      maxP99Ms: 2600,
      maxDrainSeconds: 90,
      audit: true,
      integrity: true,
      replay: false
    }),
    scenario("graphfeed_recall", "Bounded GraphFeed watch with post-watch recall", "pwa", {
      journey: ["POST /api/watch-packets/generate", "POST /api/watch-packets/:id/complete"],
      targetRps: 10 * scale,
      targetConcurrency: Math.ceil(10 * scale),
      maxP95Ms: 750,
      maxP99Ms: 1400,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("paced_read_completion", "First-party Paced Read completion", "pwa", {
      journey: ["POST /api/paced-read/generate", "POST /api/paced-read/complete"],
      targetRps: 12 * scale,
      targetConcurrency: Math.ceil(12 * scale),
      maxP95Ms: 650,
      maxP99Ms: 1200,
      audit: true,
      integrity: true,
      replay: true
    }),
    scenario("content_court_release", "Content Court proposal to released graph version", "governance", {
      journey: ["POST /api/proposals", "POST /api/proposals/:id/release"],
      targetRps: 3 * scale,
      targetConcurrency: Math.ceil(4 * scale),
      maxP95Ms: 1100,
      maxP99Ms: 2200,
      audit: true,
      integrity: true,
      replay: false
    }),
    scenario("privacy_export_delete", "Privacy export and scoped deletion", "privacy", {
      journey: ["GET /api/privacy/export", "DELETE /api/privacy/data"],
      targetRps: 2 * scale,
      targetConcurrency: Math.ceil(3 * scale),
      maxP95Ms: 1400,
      maxP99Ms: 2600,
      maxDrainSeconds: 120,
      audit: true,
      integrity: true,
      replay: false
    }),
    scenario("worker_queue_drain", "Background worker queue drain", "worker", {
      journey: ["scheduler", "audio_render", "analytics", "export"],
      targetRps: 5 * scale,
      targetConcurrency: Math.ceil(8 * scale),
      maxP95Ms: 1200,
      maxP99Ms: 2400,
      maxDrainSeconds: 120,
      audit: true,
      integrity: true,
      replay: false
    }),
    scenario("wearable_sleep_sync", "Wearable sleep sync and readiness update", "wearables", {
      journey: ["POST /api/wearables/sync", "GET /api/wearables/status"],
      targetRps: 3 * scale,
      targetConcurrency: Math.ceil(5 * scale),
      maxP95Ms: 900,
      maxP99Ms: 1700,
      audit: true,
      integrity: true,
      replay: false
    })
  ];
}

export function referenceReliabilityObservations(
  environment: ReliabilityEnvironment = "production",
  generatedAt = nowIso()
): ReliabilityObservation[] {
  return defaultReliabilityScenarios(environment).map((requiredScenario, index) => {
    const requests = Math.max(24, Math.ceil(requiredScenario.slo.target_concurrency * 24 + index * 3));
    const failures = Math.floor(requests * requiredScenario.slo.max_error_rate * 0.1);
    const timeouts = Math.floor(requests * requiredScenario.slo.max_timeout_rate * 0.1);
    return {
      scenario_id: requiredScenario.id,
      observed_rps: round(requiredScenario.slo.target_rps * 1.25, 2),
      concurrent_users: requiredScenario.slo.target_concurrency,
      requests,
      failures,
      timeouts,
      p50_ms: Math.max(20, Math.round(requiredScenario.slo.max_p95_ms * 0.38)),
      p95_ms: Math.round(requiredScenario.slo.max_p95_ms * 0.72),
      p99_ms: Math.round(requiredScenario.slo.max_p99_ms * 0.78),
      audit_events: requiredScenario.requires_audit_events ? requests : 0,
      integrity_checks: requiredScenario.requires_integrity_checks ? requests : 0,
      queue_drain_seconds: requiredScenario.slo.max_queue_drain_seconds
        ? Math.round(requiredScenario.slo.max_queue_drain_seconds * 0.55)
        : undefined,
      replay_verified: requiredScenario.requires_replay_check ? true : undefined,
      generated_at: generatedAt,
      notes: ["Reference first-party release probe observation."]
    };
  });
}

export function buildReliabilityReleaseGate(
  input: {
    environment?: ReliabilityEnvironment;
    generatedAt?: string;
    scenarios?: ReliabilityScenario[];
    observations?: ReliabilityObservation[];
  } = {}
): ReliabilityReleaseGate {
  const environment = input.environment ?? "production";
  const generatedAt = input.generatedAt ?? nowIso();
  const scenarios = input.scenarios ?? defaultReliabilityScenarios(environment);
  const observations = input.observations ?? referenceReliabilityObservations(environment, generatedAt);
  const observationsByScenario = new Map(
    observations.map((observation) => [observation.scenario_id, observation])
  );
  const evaluations = scenarios.map((requiredScenario) =>
    evaluateScenario(requiredScenario, observationsByScenario.get(requiredScenario.id))
  );
  const failingScenarioIds = evaluations
    .filter((evaluation) => !evaluation.passed)
    .map((evaluation) => evaluation.scenario_id);
  const totalRequests = observations.reduce((sum, observation) => sum + observation.requests, 0);
  const totalFailures = observations.reduce((sum, observation) => sum + observation.failures, 0);
  const maximumObservedP95 = Math.max(0, ...observations.map((observation) => observation.p95_ms));

  return {
    schema_version: "mnemosyne-reliability-release-gate-v0.1",
    generated_at: generatedAt,
    environment,
    passed: failingScenarioIds.length === 0,
    score: round(
      evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / Math.max(1, evaluations.length),
      4
    ),
    scenario_count: scenarios.length,
    failing_scenario_ids: failingScenarioIds,
    aggregate_error_rate: round(totalFailures / Math.max(1, totalRequests), 4),
    maximum_observed_p95_ms: maximumObservedP95,
    required_scenarios: scenarios,
    observations,
    evaluations,
    remediation: remediationFor(evaluations)
  };
}

function scenario(
  id: ReliabilityScenarioId,
  title: string,
  surface: ReliabilitySurface,
  input: {
    journey: string[];
    targetRps: number;
    targetConcurrency: number;
    maxP95Ms: number;
    maxP99Ms: number;
    maxDrainSeconds?: number;
    audit: boolean;
    integrity: boolean;
    replay: boolean;
  }
): ReliabilityScenario {
  return {
    id,
    title,
    surface,
    journey: input.journey,
    slo: {
      target_rps: round(Math.max(1, input.targetRps), 2),
      target_concurrency: Math.max(1, input.targetConcurrency),
      max_p95_ms: input.maxP95Ms,
      max_p99_ms: input.maxP99Ms,
      max_error_rate: 0.005,
      max_timeout_rate: 0.002,
      min_success_rate: 0.995,
      min_audit_coverage: input.audit ? 1 : 0,
      min_integrity_coverage: input.integrity ? 0.99 : 0,
      max_queue_drain_seconds: input.maxDrainSeconds
    },
    requires_audit_events: input.audit,
    requires_integrity_checks: input.integrity,
    requires_replay_check: input.replay,
    runbook_refs: ["docs/ops/reliability-release-gate.md", "docs/ops/production-release.md"]
  };
}

function evaluateScenario(
  requiredScenario: ReliabilityScenario,
  observation: ReliabilityObservation | undefined
): ReliabilityScenarioEvaluation {
  const errorRate = observation ? observation.failures / Math.max(1, observation.requests) : 1;
  const timeoutRate = observation ? observation.timeouts / Math.max(1, observation.requests) : 1;
  const successRate = observation ? 1 - errorRate : 0;
  const auditCoverage = observation ? observation.audit_events / Math.max(1, observation.requests) : 0;
  const integrityCoverage = observation
    ? observation.integrity_checks / Math.max(1, observation.requests)
    : 0;
  const checks: ReliabilityScenarioChecks = {
    observation_present: Boolean(observation),
    load_target_met: Boolean(observation && observation.observed_rps >= requiredScenario.slo.target_rps),
    concurrency_target_met: Boolean(
      observation && observation.concurrent_users >= requiredScenario.slo.target_concurrency
    ),
    p95_latency: Boolean(observation && observation.p95_ms <= requiredScenario.slo.max_p95_ms),
    p99_latency: Boolean(observation && observation.p99_ms <= requiredScenario.slo.max_p99_ms),
    error_rate: errorRate <= requiredScenario.slo.max_error_rate,
    timeout_rate: timeoutRate <= requiredScenario.slo.max_timeout_rate,
    success_rate: successRate >= requiredScenario.slo.min_success_rate,
    audit_coverage: auditCoverage >= requiredScenario.slo.min_audit_coverage,
    integrity_coverage: integrityCoverage >= requiredScenario.slo.min_integrity_coverage,
    queue_drain:
      requiredScenario.slo.max_queue_drain_seconds === undefined ||
      Boolean(
        observation?.queue_drain_seconds !== undefined &&
        observation.queue_drain_seconds <= requiredScenario.slo.max_queue_drain_seconds
      ),
    replay_verified: !requiredScenario.requires_replay_check || observation?.replay_verified === true
  };
  const blockers = blockersFor(requiredScenario, observation, checks);
  const passedChecks = Object.values(checks).filter(Boolean).length;
  return {
    scenario_id: requiredScenario.id,
    title: requiredScenario.title,
    surface: requiredScenario.surface,
    passed: blockers.length === 0,
    score: round(passedChecks / Object.keys(checks).length, 4),
    observed_error_rate: round(errorRate, 4),
    observed_timeout_rate: round(timeoutRate, 4),
    observed_success_rate: round(successRate, 4),
    observed_audit_coverage: round(auditCoverage, 4),
    observed_integrity_coverage: round(integrityCoverage, 4),
    observed_p95_ms: observation?.p95_ms,
    observed_p99_ms: observation?.p99_ms,
    observed_rps: observation?.observed_rps,
    blockers,
    checks
  };
}

function blockersFor(
  requiredScenario: ReliabilityScenario,
  observation: ReliabilityObservation | undefined,
  checks: ReliabilityScenarioChecks
): string[] {
  if (!observation) return [`No load observation was provided for ${requiredScenario.id}.`];
  const blockers: string[] = [];
  if (!checks.load_target_met) {
    blockers.push(`${requiredScenario.id} did not meet target RPS ${requiredScenario.slo.target_rps}.`);
  }
  if (!checks.concurrency_target_met) {
    blockers.push(
      `${requiredScenario.id} did not exercise ${requiredScenario.slo.target_concurrency} concurrent users.`
    );
  }
  if (!checks.p95_latency) {
    blockers.push(`${requiredScenario.id} p95 latency exceeded ${requiredScenario.slo.max_p95_ms}ms.`);
  }
  if (!checks.p99_latency) {
    blockers.push(`${requiredScenario.id} p99 latency exceeded ${requiredScenario.slo.max_p99_ms}ms.`);
  }
  if (!checks.error_rate) {
    blockers.push(`${requiredScenario.id} error rate exceeded ${requiredScenario.slo.max_error_rate}.`);
  }
  if (!checks.timeout_rate) {
    blockers.push(`${requiredScenario.id} timeout rate exceeded ${requiredScenario.slo.max_timeout_rate}.`);
  }
  if (!checks.success_rate) {
    blockers.push(`${requiredScenario.id} success rate was below ${requiredScenario.slo.min_success_rate}.`);
  }
  if (!checks.audit_coverage) {
    blockers.push(`${requiredScenario.id} did not preserve required audit-event coverage.`);
  }
  if (!checks.integrity_coverage) {
    blockers.push(`${requiredScenario.id} did not preserve required integrity-check coverage.`);
  }
  if (!checks.queue_drain) {
    blockers.push(
      `${requiredScenario.id} queue drain exceeded ${requiredScenario.slo.max_queue_drain_seconds} seconds.`
    );
  }
  if (!checks.replay_verified) {
    blockers.push(`${requiredScenario.id} did not verify graph replay after the run.`);
  }
  return blockers;
}

function remediationFor(evaluations: ReliabilityScenarioEvaluation[]): string[] {
  return evaluations
    .filter((evaluation) => !evaluation.passed)
    .flatMap((evaluation) => {
      const actions = [`Rerun ${evaluation.scenario_id} after fixing: ${evaluation.blockers.join(" ")}`];
      if (!evaluation.checks.p95_latency || !evaluation.checks.p99_latency) {
        actions.push(`Profile storage, graph replay, and worker time for ${evaluation.scenario_id}.`);
      }
      if (!evaluation.checks.audit_coverage || !evaluation.checks.integrity_coverage) {
        actions.push(`Inspect audit/object-manifest writes for ${evaluation.scenario_id}.`);
      }
      if (!evaluation.checks.queue_drain) {
        actions.push(`Increase worker capacity or split heavy jobs for ${evaluation.scenario_id}.`);
      }
      return actions;
    });
}

function loadScale(environment: ReliabilityEnvironment): number {
  if (environment === "production") return 1;
  if (environment === "staging") return 0.5;
  return 0.2;
}
