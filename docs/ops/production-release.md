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

The code-level readiness contract is documented in [`queues-and-object-storage.md`](./queues-and-object-storage.md). Production adapters must preserve the same job lifecycle, idempotency, object manifest, audit, export, and deletion behavior.

The local production-like container contract is `infra/docker/docker-compose.yml`. It starts Postgres, Redis, MinIO, the API, scheduler worker, audio-render worker, and a shared object-storage volume. Staging and production deployment manifests should preserve the same process split even when they replace local volumes with managed services.

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
- dead-letter count and stale worker locks
- object manifest encryption and SHA-256 coverage
- daily packet generation failures
- assessment scoring failures
- tutor release-gate failures and high-stakes review escalations
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

Generate a first-party incident artifact with `POST /api/ops/incidents/reports` whenever monitoring is degraded or critical. The artifact is written to the `evidence` bucket, audited as `ops_incident_report_stored`, and should be attached to the release notes or incident log. See [`incident-response.md`](./incident-response.md).

## Backups and Recovery

- Postgres point-in-time recovery enabled.
- Object storage versioning enabled for production buckets.
- `POST /api/ops/backups/jobs` produces a `mnemosyne-system-backup-v0.1` artifact in the `backup` bucket with a persisted object manifest and `system_backup_object_stored` audit event.
- `POST /api/ops/backups/:id/restore-drills/jobs` verifies the backup object, schema, counts, graph bundles, sleep ownership, audit continuity, and export/deletion fields with a `system_backup_restore_drill_completed` audit event.
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

`GET /api/accessibility/release-gate` returns the first-party accessibility release report and audits `accessibility_release_gate_checked`. See [`../accessibility/release-gate.md`](../accessibility/release-gate.md).

## Load and Reliability Gate

Exercise:

- onboarding completion
- daily packet generation
- Morning Forge completion
- tutor turn scoring
- WalkMode completion
- Evening Lock-In completion
- SleepCue playback event ingestion
- next-morning recall completion
- GraphFeed recall completion
- Paced Read completion
- proposal release
- wearable sync
- export and deletion

The system should preserve audit events even when downstream analytics or personalization rollups are delayed.

`GET /api/reliability/release-gate` returns the first-party reliability release report and audits `reliability_release_gate_checked`. The underlying `@mnemosyne/reliability-core` evaluator covers target request rate, concurrency, p95/p99 latency, error and timeout rates, audit coverage, integrity checks, graph replay verification, and queue-drain budgets for the core learning journeys. See [`reliability-release-gate.md`](./reliability-release-gate.md).

## Offline Sync Gate

Before production release, the PWA must register its service worker, expose a valid manifest, persist learning actions to IndexedDB, attach idempotency keys, avoid secrets in queued payloads, recover stale sync locks, and cover the core daily actions: packet cache, Morning Forge, GraphFeed, Paced Read, WalkMode, Evening Lock-In, SleepCue playback, and SleepCue recall.

`@mnemosyne/offline-core` provides `buildOfflineReleaseGate` for deterministic release checks. The Workbench surface exposes queue state and recovery controls. See [`../offline/pwa-sync.md`](../offline/pwa-sync.md).

## Release Checklist

- `main` is green.
- GitHub repository visibility is public.
- GitHub license detection reports MIT.
- `README.md`, `ROADMAP.md`, `SECURITY.md`, and docs are current.
- `/api/security/release-gate` passes for the target environment.
- `/api/accessibility/release-gate` passes for the target environment.
- `/api/reliability/release-gate` passes for the target environment.
- `buildOfflineReleaseGate` passes with service worker, manifest, IndexedDB, idempotency, privacy-safe payload, and stale-lock recovery checks.
- `POST /api/offline/actions/sync` accepts queued PWA actions, returns receipt ids, and audits `offline_action_synced`.
- `POST /api/ops/incidents/reports` can create a `mnemosyne-incident-response-v0.1` artifact from the target environment monitoring snapshot.
- The API HTTP adapter is serving CSP/security headers, CSRF enforcement, bounded JSON parsing, and rate-limit responses in the target environment.
- Postgres migrations through `0003_job_claim_indexes.sql` are applied and the API is constructed with `createPostgresStore`.
- Object storage root is mounted durably, and `/api/objects/store` writes bytes, validates SHA-256 integrity, and persists manifests.
- `POST /api/graph/user/replay` can dry-run and persist replayed personal graph state from assessment responses and learning events, auditing `user_graph_replayed`.
- Scheduler, ingestion, audio-render, notification, local-AI, moderation, analytics, and export workers run `@mnemosyne/worker-core` handlers for `scheduler:generate_daily_packet`, `ingestion:process_creator_submission`, `audio_render:render_sleep_audio`, `notification:deliver_learning_reminder`, `local_ai:review_proposal`, `moderation:triage_proposal`, `analytics:refresh_outcome_dashboard`, and `export:build_privacy_export`, including audit events, retries, and dead-letter handling.
- `POST /api/creator/ingestions/jobs` queues creator drafts, and ingestion workers audit `creator_ingestion_processed` after creating Content Court proposals.
- `POST /api/notifications/schedule` queues reminder outbox work, and notification workers audit `notification_outbox_recorded` without fabricating push delivery.
- `POST /api/proposals/:id/arbiter/jobs` queues local Content Court arbiter work, and local-AI workers audit `proposal_local_arbiter_reviewed` without calling a hosted model.
- `POST /api/proposals/:id/moderation/jobs` queues Content Court triage work, and moderation workers audit `proposal_moderation_triaged` with first-party policy checks and status transitions.
- `POST /api/outcomes/refresh/jobs` queues outcome rollups, and the analytics worker persists dashboards with quality-gate audit payloads.
- `POST /api/privacy/export/jobs` queues export artifacts, and the export worker writes JSON bundles to the first-party `export` object bucket.
- Postgres job leasing uses `claimNextRunnableJob` row locks so parallel worker processes do not double-start runnable jobs.
- `npm run worker:start` is deployed for worker processes with `MNEMOSYNE_WORKER_QUEUES`, `MNEMOSYNE_WORKER_ID`, and `MNEMOSYNE_OBJECT_STORAGE_ROOT` set per environment.
- A scheduled worker recovery run uses `MNEMOSYNE_WORKER_MODE=recover` to clear stale running locks and audit `job_recovered` or `job_dead_lettered` outcomes.
- `npm run docker:config` passes for the local deployment manifest.
- `GET /healthz` returns liveness, and `GET /readyz` returns dependency-backed readiness with healthy store and object-storage components.
- `GET /api/ops/monitoring?userId=<operator>&environment=<target>` reports `ready_for_release: true`, `status: nominal`, and green ops, security, and dependency gates.
- Production secrets are rotated into the target environment.
- Database migrations are applied in staging first.
- Restore drill completed for the release window.
- Admin moderation and privacy operations are accessible.
- Incident owner and rollback plan are named.
