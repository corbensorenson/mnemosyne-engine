# API Runtime

The API service is executable through the workspace scripts:

```bash
npm run api:migrate
npm run api:dev
npm run worker:start
npm run docker:up
```

`npm run api:dev` starts `@mnemosyne/api` on `HOST` and `PORT`, defaulting to `0.0.0.0:8787`. The runtime exposes:

- `GET /healthz`
- `GET /readyz`
- all `/api/*` routes from the first-party HTTP adapter

Release-gate routes include `/api/security/release-gate`, `/api/accessibility/release-gate`, `/api/reliability/release-gate`, and `/api/ops/monitoring`.

`GET /healthz` is a cheap liveness check. `GET /readyz` verifies the configured `MnemosyneStore` and object-storage adapter before returning `200`; dependency failures return `503 service_not_ready` with per-component status details.

## Environment

Important variables:

- `MNEMOSYNE_ENV`: `local`, `staging`, or `production`
- `MNEMOSYNE_STORAGE`: `memory` or `postgres`
- `DATABASE_URL`: Postgres connection string when storage is `postgres`
- `MNEMOSYNE_RUN_MIGRATIONS`: set to `true` to run migrations during startup
- `MNEMOSYNE_SEED_DEMO`: set to `true` to seed demo data
- `MNEMOSYNE_MIGRATIONS_DIR`: optional path to migration files
- `MNEMOSYNE_OBJECT_STORAGE_ROOT`: local object storage root for audio, transcripts, imports, generated assets, exports, evidence, and backups

If `DATABASE_URL` is present and `MNEMOSYNE_STORAGE` is unset, the runtime chooses Postgres. Without `DATABASE_URL`, it falls back to memory storage for local development.

## Migrations

`npm run api:migrate` applies every `.sql` file in `infra/migrations` in filename order and records applied filenames in `mnemosyne_migrations`. Each migration runs inside an explicit transaction.

Production deployments should run migrations as a release step before starting web/API traffic. Local deployments can set `MNEMOSYNE_RUN_MIGRATIONS=true` to run migrations during API startup.

## Worker Service

`npm run worker:start` starts `@mnemosyne/worker-service` with the same memory/Postgres, migration, demo-seed, and object-storage settings as the API runtime.

Worker variables:

- `MNEMOSYNE_WORKER_MODE`: `once`, `batch`, `loop`, or `recover` (default `loop`)
- `MNEMOSYNE_WORKER_ID`: stable worker id for locks and audit payloads
- `MNEMOSYNE_WORKER_QUEUES`: comma-separated queue filter, for example `scheduler,audio_render`
- `MNEMOSYNE_WORKER_MAX_JOBS`: maximum jobs in one batch run
- `MNEMOSYNE_WORKER_POLL_MS`: loop sleep interval when no runnable job is available
- `MNEMOSYNE_WORKER_MAX_ITERATIONS`: optional loop cap for smoke tests and one-off maintenance
- `MNEMOSYNE_WORKER_STALE_AFTER_MINUTES`: stale running-lock threshold for recovery mode
- `MNEMOSYNE_WORKER_RECOVERY_LIMIT`: maximum stale locks recovered in one maintenance run
- `MNEMOSYNE_AUDIO_OUTPUT_FORMAT`: render-manifest format hint, `m4a`, `mp3`, or `wav`

The first executable worker handles `scheduler:generate_daily_packet`, `ingestion:process_creator_submission`, `audio_render:render_sleep_audio`, `notification:deliver_learning_reminder`, `local_ai:review_proposal`, `moderation:triage_proposal`, `analytics:refresh_outcome_dashboard`, `export:build_privacy_export`, `export:build_system_backup`, and `export:run_system_backup_restore_drill`. A scheduler job persists the daily packet, sleep packet, and audio plan, then queues the audio render job. The ingestion worker turns creator drafts into Content Court proposals through the first-party Creator Studio handler. The audio worker writes a deterministic render-manifest object through configured object storage and updates the audio plan to `ready`. The notification worker records first-party reminder outbox events without claiming third-party push delivery. The local AI worker runs the first-party Content Court arbiter without calling a hosted model. The moderation worker triages proposals from stored risk, evidence, high-stakes, counterevidence, change-size, and dispute signals without a third-party moderation API. The analytics worker refreshes outcome dashboards from persisted assessment responses, learning events, and graph state. The export worker builds user data export artifacts in the first-party `export` bucket, system backup artifacts in the first-party `backup` bucket, and restore-drill reports from stored backup objects.

Recovery mode runs `recoverStaleWorkerLocks`, clearing stale running locks back to retryable `failed` state when attempts remain and dead-lettering jobs that exhausted their final attempt. Each recovered job emits `job_recovered` or `job_dead_lettered` audit events with the previous lock holder.

## Local Compose

`npm run docker:config` validates the local Compose model. `npm run docker:up` starts Postgres, Redis, MinIO, the API, scheduler, ingestion, audio-render, notification, local-AI, moderation, analytics, and export workers. The API listens on `http://127.0.0.1:8787` and uses Postgres with migrations enabled. API and workers share the `object-storage` volume at `/var/lib/mnemosyne/objects`. Incident reports are generated by the API from current monitoring and written to the first-party `evidence` bucket.

Smoke checks:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

Stop the stack with `npm run docker:down`.
