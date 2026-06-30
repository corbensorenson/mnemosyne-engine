# Queues and Object Storage

Mnemosyne treats background work and stored artifacts as first-party product state. The current implementation does not depend on a vendor API for simple learner workflows; it models the queue, worker lifecycle, object manifest, audit trail, privacy export, and release gates in the repo before any Redis or object-storage adapter is attached.

## Package

`@mnemosyne/ops-core` owns the durable contract:

- queue names: `ingestion`, `ai`, `audio_render`, `notification`, `analytics`, `export`, `moderation`
- job lifecycle: `queued`, `running`, `completed`, `failed`, `dead_lettered`, `cancelled`
- job safety: idempotency keys, `run_after`, priority, attempts, max attempts, worker locks, results, and last errors
- object buckets: `audio`, `transcript`, `import`, `generated_asset`, `export`, `evidence`, `backup`
- object safety: owner id, content type, byte size, SHA-256, retention policy, encryption status, metadata, and created time

The core package is intentionally storage-agnostic. Redis workers, Postgres tables, object-storage SDKs, and local dev adapters should implement this contract rather than redefining queue semantics in each service.

## API Surface

The API service now exposes:

- `POST /api/jobs`
- `POST /api/jobs/:id/start`
- `POST /api/jobs/:id/complete`
- `POST /api/jobs/:id/fail`
- `POST /api/objects`
- `GET /api/ops/health`

Handlers persist job records and object manifests through `MnemosyneStore`, emit audit events for job/object transitions, and restrict job operations to the audited subject owner.

## Health Gates

`buildOpsHealthDashboard` reports:

- per-queue depth, runnable jobs, delayed jobs, running jobs, completed jobs, failed jobs, dead letters, critical depth, oldest queued time, and stale locks
- per-bucket object count, bytes, encrypted count, and integrity-tracked count
- release gates for configured queues, no dead letters, no stale running jobs, encrypted objects, SHA-256 coverage, and idempotency keys

These gates are product-level readiness checks. They should remain green before promotion even if the backing adapter changes from in-memory development storage to Redis, Postgres, and managed object storage.

## Privacy

User data export includes owned jobs and object manifests. Full account deletion removes user-owned job records and object manifests, while scoped sleep deletion removes owned audio manifests. Audit events are retained or anonymized according to the privacy deletion policy.

## Next Adapter Work

The next production step is to map this contract onto:

- Postgres tables for canonical job and object-manifest records
- Redis streams or sorted sets for runnable queue indexes
- managed object storage for audio, transcripts, imports, generated assets, evidence files, backups, and privacy exports
- worker binaries for scheduler, audio rendering, analytics rollups, notifications, and moderation
