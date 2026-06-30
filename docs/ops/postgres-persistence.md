# Postgres Persistence

Mnemosyne now has a driver-agnostic Postgres store path for production API deployments. The in-memory store remains useful for tests, local demos, and isolated package work, but production services should construct the API with `createPostgresStore`.

## Migration

Apply migrations in order:

1. `infra/migrations/0001_foundation.sql`
2. `infra/migrations/0002_postgres_record_store.sql`
3. `infra/migrations/0003_job_claim_indexes.sql`

`0001` keeps the normalized relational foundation. `0002` adds `mnemosyne_records`, a JSONB record table used by the first production store adapter so every `MnemosyneStore` entity has durable storage while normalized projections continue to mature. `0003` adds job queue/status and handler-key indexes for worker lease scans.

## Adapter Contract

`@mnemosyne/persistence-core` exports:

- `createPostgresStore(sql)`
- `PostgresMnemosyneStore`
- `seedPostgresStore(store, seed)`
- `SqlExecutor`

The `SqlExecutor` interface is intentionally tiny:

```ts
type SqlExecutor = {
  query<T>(statement: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
};
```

A `pg.Pool` or `pg.Client` can satisfy this contract directly.

## Stored Records

Records are keyed by `record_type` and `record_id`, with `owner_id` and `sort_key` indexes for common user export, deletion, and dashboard queries. Payloads are parameterized JSONB values; tests assert user ids are passed as query parameters rather than interpolated into SQL strings.

## Privacy Semantics

The Postgres adapter preserves the same export and deletion behavior as the memory store:

- voice deletion scrubs transcript/audio fields in learning events
- sleep deletion removes cue packets, sleep audio plans, sleep object manifests, and sleep learning events
- health deletion removes wearable connections and normalized sleep imports
- account deletion removes user-owned records, removes pack installations, updates/deletes social challenge participation, and anonymizes retained audit events

## Queue Leasing

Workers call `MnemosyneStore.claimNextRunnableJob` before executing work. In Postgres, the adapter uses a single row-locking claim query with `FOR UPDATE SKIP LOCKED`, handler-key filtering, priority ordering, `run_after` checks, attempt increments, and `locked_at`/`locked_by` updates. Parallel worker processes can therefore compete for the same queue without double-starting the same job record.
