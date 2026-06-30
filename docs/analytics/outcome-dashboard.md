# Outcome Dashboard

Mnemosyne's learning quality gate is based on measured outcomes, not activity volume. The outcome dashboard turns assessment responses, learning events, and personal graph state into auditable windows.

## Package

`@mnemosyne/outcome-core`

The package builds:

- immediate recall rollup
- 24h recall rollup
- 7d recall rollup
- 30d recall rollup
- latency metrics
- confidence calibration error
- transfer and retention scores from graph state
- screen minutes from learning events
- SleepCue gain from matched cued/control recall events
- quality gate booleans
- recommendations for missing evidence

Default windows:

- `immediate`: 0 to 4 hours old
- `24h`: 20 to 36 hours old
- `7d`: 6 to 8 days old
- `30d`: 27 to 33 days old

## API Surface

- `GET /api/outcomes/dashboard`
- `POST /api/outcomes/refresh`

Refreshing a dashboard persists the rollup and emits `outcome_dashboard_refreshed`.

## Quality Gates

The dashboard reports whether these gates have evidence:

- immediate recall measured
- 24h recall measured
- 7d recall measured
- 30d recall measured
- transfer measured
- latency measured
- confidence calibration measured
- screen load measured
- sleep effect measured with controls

## Privacy

Outcome dashboards are user-owned private data. They are included in self-serve export bundles and removed on full account deletion.

## Test Coverage

The unit suite verifies:

- correct window assignment for immediate, 24h, 7d, and 30d responses
- quality gate coverage when all windows exist
- recommendations when delayed recall evidence is missing
- API persistence of refreshed dashboards
- export inclusion for outcome dashboards
- audit event emission for dashboard refresh
