# API Runtime

The API service is executable through the workspace scripts:

```bash
npm run api:migrate
npm run api:dev
npm run worker:start
```

`npm run api:dev` starts `@mnemosyne/api` on `HOST` and `PORT`, defaulting to `0.0.0.0:8787`. The runtime exposes:

- `GET /healthz`
- `GET /readyz`
- all `/api/*` routes from the first-party HTTP adapter

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

- `MNEMOSYNE_WORKER_MODE`: `once`, `batch`, or `loop` (default `loop`)
- `MNEMOSYNE_WORKER_ID`: stable worker id for locks and audit payloads
- `MNEMOSYNE_WORKER_QUEUES`: comma-separated queue filter, for example `scheduler,audio_render`
- `MNEMOSYNE_WORKER_MAX_JOBS`: maximum jobs in one batch run
- `MNEMOSYNE_WORKER_POLL_MS`: loop sleep interval when no runnable job is available
- `MNEMOSYNE_WORKER_MAX_ITERATIONS`: optional loop cap for smoke tests and one-off maintenance
- `MNEMOSYNE_AUDIO_OUTPUT_FORMAT`: render-manifest format hint, `m4a`, `mp3`, or `wav`

The first executable worker handles `scheduler:generate_daily_packet` and `audio_render:render_sleep_audio`. A scheduler job persists the daily packet, sleep packet, and audio plan, then queues the audio render job. The audio worker writes a deterministic render-manifest object through configured object storage and updates the audio plan to `ready`.
