# Queues and Object Storage

Mnemosyne treats background work and stored artifacts as first-party product state. The current implementation does not depend on a vendor API for simple learner workflows; it models the queue, worker lifecycle, object manifest, object bytes, audit trail, privacy export, and release gates in the repo before any Redis or managed object-storage adapter is attached.

## Package

`@mnemosyne/ops-core` owns the durable contract:

- queue names: `scheduler`, `ingestion`, `ai`, `audio_render`, `notification`, `analytics`, `export`, `moderation`
- job lifecycle: `queued`, `running`, `completed`, `failed`, `dead_lettered`, `cancelled`
- job safety: idempotency keys, `run_after`, priority, attempts, max attempts, worker locks, results, and last errors
- object buckets: `audio`, `transcript`, `import`, `generated_asset`, `export`, `evidence`, `backup`
- object safety: owner id, content type, byte size, SHA-256, retention policy, encryption status, metadata, and created time

The ops package is intentionally storage-agnostic. Redis workers, Postgres tables, object-storage SDKs, and local dev adapters should implement this contract rather than redefining queue semantics in each service.

`@mnemosyne/storage-core` provides the first concrete object-storage adapter:

- local filesystem storage rooted at `MNEMOSYNE_OBJECT_STORAGE_ROOT`
- safe object-key validation that blocks absolute paths, traversal, empty segments, and backslashes
- SHA-256 and byte-size verification on writes and reads
- JSON sidecar manifests generated from the same `ObjectManifest` contract used by ops health
- `POST /api/objects/store` for API-mediated writes that persist both object bytes and the manifest

`@mnemosyne/worker-core` provides the first runnable queue adapter:

- leases the highest-priority runnable job whose queue/type has a registered handler
- starts, completes, fails, retries, or dead-letters jobs through the same `JobRecord` lifecycle as the API
- emits job audit events with worker id, queue, type, status, attempts, result keys, and errors
- supports bounded single-run, batch, and polling-loop execution for service processes
- passes optional object storage into handlers so generated artifacts can be persisted without a vendor API

`MnemosyneStore.claimNextRunnableJob` is the store-level lease contract. The memory adapter uses the same priority/run-after ordering as tests and local demos. The Postgres adapter claims jobs with a single row-locking `UPDATE ... FOR UPDATE SKIP LOCKED` query, filters to registered handler keys, increments attempts, sets `locked_at`/`locked_by`, and returns the running job. This keeps parallel worker processes from double-starting the same job while preserving the first-party `JobRecord` lifecycle.

`recoverStaleWorkerLocks` is the maintenance recovery path for workers that die after claiming a job. It scans running jobs whose locks exceed the configured stale threshold, clears their locks, returns them to retryable `failed` state when attempts remain, dead-letters jobs that exhausted their final attempt, and emits `job_recovered` or `job_dead_lettered` audit events with the previous lock holder.

The scheduler service registers `scheduler:generate_daily_packet`. The handler loads the user, goals, readiness, master graph, personal graph, and personalization profile from `MnemosyneStore`, saves the daily packet, sleep packet, and audio plan, then queues `audio_render:render_sleep_audio`.

The audio renderer service registers `audio_render:render_sleep_audio`. The handler builds the deterministic render manifest, stores it as a first-party object when object storage is configured, updates the audio plan render status, and leaves failures for the worker runtime to retry or dead-letter.

The notification worker registers `notification:deliver_learning_reminder`. The handler records first-party outbox audit events for in-app, web-push-ready, or native-companion-ready reminders without relying on a hosted notification API.

The analytics worker registers `analytics:refresh_outcome_dashboard`. The handler builds outcome dashboards from persisted assessment responses, learning events, and graph state, saves the dashboard, and audits the rollup quality gates.

The privacy export worker registers `export:build_privacy_export`. The handler loads the user export bundle from `MnemosyneStore`, writes the bundle as JSON through configured object storage, persists the `export` object manifest, and audits the stored artifact.

`@mnemosyne/worker-service` is the executable process wrapper. `npm run worker:start` uses the same `MNEMOSYNE_STORAGE`, `DATABASE_URL`, migration, demo-seed, and object-root settings as the API runtime, plus worker-specific queue, mode, batch, poll, and audio-format settings.

## API Surface

The API service now exposes:

- `POST /api/jobs`
- `POST /api/jobs/:id/start`
- `POST /api/jobs/:id/complete`
- `POST /api/jobs/:id/fail`
- `POST /api/notifications/schedule`
- `POST /api/outcomes/refresh/jobs`
- `POST /api/privacy/export/jobs`
- `POST /api/objects`
- `POST /api/objects/store`
- `GET /api/ops/monitoring`
- `GET /api/ops/health`

Handlers persist job records and object manifests through `MnemosyneStore`, emit audit events for job/object transitions, restrict job operations to the audited subject owner, and write uploaded object bytes through configured object storage before saving manifests.

## Health Gates

`buildOpsHealthDashboard` reports:

- per-queue depth, runnable jobs, delayed jobs, running jobs, completed jobs, failed jobs, dead letters, critical depth, oldest queued time, and stale locks
- per-bucket object count, bytes, encrypted count, and integrity-tracked count
- release gates for configured queues, no dead letters, no stale running jobs, encrypted objects, SHA-256 coverage, and idempotency keys

These gates are product-level readiness checks. They should remain green before promotion even if the backing adapter changes from in-memory development storage to Redis, Postgres, and managed object storage.

## Monitoring

`buildOpsMonitoringDashboard` turns health gates into deterministic alerts and service levels. The API route combines:

- queue depth, runnable backlog, critical-priority backlog, retryable failures, dead letters, and stale locks
- object encryption and SHA-256 integrity coverage by bucket
- dependency readiness for store and object storage adapters
- security release-gate status for CSP, CSRF, rate limits, high-stakes labels, expert review, and audit safety

The dashboard reports `nominal`, `degraded`, or `critical`, alert counts, individual alert IDs, service levels, and a `ready_for_release` flag. This is a first-party contract; hosted monitoring, paging, or metrics exporters should consume it rather than redefining Mnemosyne's release semantics.

## Privacy

User data export includes owned jobs and object manifests. Full account deletion removes user-owned job records and object manifests, while scoped sleep deletion removes owned audio manifests. Audit events are retained or anonymized according to the privacy deletion policy.

## Next Adapter Work

The next production step is to map this contract onto:

- normalized Postgres projections for canonical job and object-manifest records
- optional Redis streams or sorted sets for runnable queue indexes when scale requires an external index
- managed object storage for audio, transcripts, imports, generated assets, evidence files, backups, and privacy exports, using the same manifest and integrity behavior as the local adapter
- worker binaries for analytics rollups, notifications, moderation, ingestion, export, and AI jobs following the same `@mnemosyne/worker-core` handler contract
