# Production Release Runbook

This runbook defines the release gate for public Mnemosyne deployments. The repo is public and MIT licensed; production readiness depends on the checks below passing before a tagged release is promoted.

## Release Gate

Run locally and in CI:

```bash
npm install
npm run verify
```

`npm run verify` must pass lint, format check, typecheck, unit tests, production PWA build, and dependency audit.

## Deployment Environments

Minimum environments:

- `local`: Docker and workspace scripts for development.
- `staging`: production-like secrets, database, queues, object storage, and monitoring.
- `production`: locked secrets, backups, alerts, incident runbook, and release tags.

Required services:

- API service
- PWA static hosting
- Postgres
- Redis queue
- object storage for audio, transcripts, imports, generated assets, and exports
- scheduler worker
- audio renderer worker
- analytics/rollup worker

## Required Secrets

- session signing secret
- OAuth/passkey provider credentials
- wearable provider client ids and secrets
- health token encryption root
- object storage credentials
- queue credentials
- analytics sink credentials

Secrets must not be bundled into the PWA.

## Monitoring

Track:

- API availability and latency
- queue depth and job failure rate
- daily packet generation failures
- assessment scoring failures
- audio render failures
- sleep playback event ingestion failures
- wearable sync and revoke failures
- Content Court release failures
- export and deletion request failures
- dependency audit status

High-priority alerts:

- auth/session failure spike
- privacy deletion failure
- wearable token encryption or revocation failure
- sleep cue disruption spike
- AI governance review failure
- graph release rollback

## Backups and Recovery

- Postgres point-in-time recovery enabled.
- Object storage versioning enabled for production buckets.
- Queue jobs are idempotent or deduplicated by object id.
- Backups are restored into staging on a recurring schedule.
- Restore drills must verify user graph, audit log, sleep packets, and export/deletion flows.

## Accessibility Gate

Before production release:

- keyboard navigation across all primary surfaces
- visible focus states
- no keyboard traps
- screen reader labels for icon-only controls
- reduced motion respected
- contrast checked for default palette
- text scaling checked at mobile and desktop widths
- no horizontal document overflow at phone width

## Load and Reliability Gate

Exercise:

- onboarding completion
- daily packet generation
- Morning Forge completion
- WalkMode completion
- Evening Lock-In completion
- SleepCue playback event ingestion
- next-morning recall completion
- GraphFeed recall completion
- Flash completion
- proposal release
- wearable sync
- export and deletion

The system should preserve audit events even when downstream analytics or personalization rollups are delayed.

## Release Checklist

- `main` is green.
- GitHub repository visibility is public.
- GitHub license detection reports MIT.
- `README.md`, `ROADMAP.md`, `SECURITY.md`, and docs are current.
- Production secrets are rotated into the target environment.
- Database migrations are applied in staging first.
- Restore drill completed for the release window.
- Admin moderation and privacy operations are accessible.
- Incident owner and rollback plan are named.
