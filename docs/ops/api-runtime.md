# API Runtime

The API service is executable through the workspace scripts:

```bash
npm run api:migrate
npm run api:dev
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
