# Reliability Release Gate

Mnemosyne keeps load and reliability checks first-party. The release gate is a deterministic contract for the journeys that must stay fast, audited, replayable, and recoverable before public promotion.

## API

`GET /api/reliability/release-gate?userId=<operator>&environment=<target>` returns a `mnemosyne-reliability-release-gate-v0.1` report and audits `reliability_release_gate_checked`.

The core evaluator lives in `@mnemosyne/reliability-core`. It can evaluate real staging observations by passing observed scenario metrics into `buildReliabilityReleaseGate`.

## Required Scenarios

- API liveness and readiness.
- Onboarding to first daily packet.
- Morning Forge completion and graph replay.
- WalkMode completion through voice or text fallback.
- Evening Lock-In to SleepCue packet handoff.
- Sleep audio render manifest generation and queue drain.
- Bounded GraphFeed recall completion.
- First-party Paced Read completion.
- Content Court proposal release.
- Privacy export and scoped deletion.
- Worker queue drain across scheduler, audio, analytics, and export work.
- Wearable sleep sync and readiness update.

## Pass Criteria

Each scenario must meet:

- target request rate and concurrency for the target environment
- p95 and p99 latency budgets
- error, timeout, and success-rate budgets
- full audit-event coverage where user data or graph state changes
- object/storage integrity coverage where artifacts are written
- graph replay verification for learning-state mutations
- queue-drain budgets for worker-backed flows

The gate fails closed when a required scenario has no observation, misses load, exceeds latency, loses audit events, loses integrity checks, misses replay verification, or lets queues drain too slowly.

## Release Use

Run the gate in staging after `npm run verify`, migrations, worker startup, object storage, and restore drills. Attach the gate output to release notes with security, accessibility, ops monitoring, backup restore, and incident artifacts.
