# PWA Offline Sync

Mnemosyne keeps offline learning actions first-party. The PWA uses the browser service worker for shell caching and an IndexedDB-backed queue for learning actions that need replay when connectivity returns.

## Queue Contract

The shared contract lives in `@mnemosyne/offline-core`.

Queued items include:

- daily packet cache refresh
- Morning Forge responses
- GraphFeed recall completions
- Paced Read completions
- WalkMode completions
- Evening Lock-In completions
- SleepCue playback events
- next-morning SleepCue recall completions
- wearable sleep sync summaries
- privacy and incident staging operations

Every item carries an idempotency key, payload hash, payload scope, retry budget, and status. Payloads are checked for obvious secrets before release.

## Browser Storage

The web app stores queue entries in `mnemosyne-offline-v1` with the `offline_actions` object store. Indexes cover user, status, action type, and update time.

The Workbench surface exposes the queue ledger with queued, synced, retryable, and stale counts plus Sync, Recover, and Clear Synced controls.

## Recovery

Recovery moves stale `syncing` items back to `queued` while retry budget remains. Exhausted items fail closed for manual inspection. Sync uses stable idempotency keys so repeated flushes do not double-count learning progress.

## Release Gate

`buildOfflineReleaseGate` checks service worker registration, manifest presence, IndexedDB availability, required action coverage, idempotency keys, privacy-safe payloads, stale-lock recovery, and retry budget.
