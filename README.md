# Mnemosyne Engine

Mnemosyne Engine is a TypeScript-first foundation for a universal learning operating system: personal knowledge graphs, daily graph scheduling, voice-first sessions, bounded video, a first-party paced-reading engine, content governance, technique experiments, and sleep-protective targeted reactivation.

This repository is MIT licensed so the code can be used, forked, modified, and commercialized with minimal friction.

## What Exists Now

- `apps/web`: installable PWA shell with the core product surfaces: Today, Graph, Morning Forge, GraphFeed, WalkMode, Evening Lock-In, Sleep, Stats, Social, Wear, Packs, Content Court, Lab, Workbench with offline sync recovery, and Admin with incident command plus privacy operations.
- `packages/schema`: shared Zod schemas and TypeScript types for graph, user state, sessions, sleep cues, content court, experiments, packs, videos, and events.
- `packages/accessibility-core`: first-party PWA accessibility release gates for keyboard, focus, labels, reduced motion, contrast, text scaling, and overflow.
- `packages/auth-core`: session issuance, hashed tokens, CSRF checks, RBAC, consent gates, and object-level authorization.
- `packages/notification-core`: first-party learning reminder planning for morning, evening, phone-down, and SleepCue recall prompts.
- `packages/offline-core`: first-party PWA offline action queueing, idempotent sync, stale-lock recovery, and offline release gates.
- `packages/outcome-core`: immediate, 24h, 7d, and 30d learning outcome rollups with quality gates.
- `packages/ops-core`: first-party queue, job lifecycle, object manifest, ops health, monitoring alert, and incident response primitives.
- `packages/persistence-core`: in-memory and Postgres-backed stores for users, graphs, sessions, events, privacy, backups, ops, and product state.
- `packages/reliability-core`: first-party load and reliability release gates for critical learning journeys, worker drain, audit coverage, integrity checks, and graph replay verification.
- `packages/graph-core`: graph gap analysis, prerequisite debt, pathing, and user graph snapshots.
- `packages/replay-core`: first-party replay of persisted assessments and learning events into touched personal graph state.
- `packages/scheduler-core`: daily packet builder joining graph, assessment, video, walk, evening, and sleep planning.
- `packages/security-core`: CSP, rate-limit, high-stakes-domain, and audit-safety release gates.
- `packages/storage-core`: first-party local object storage with safe keys, SHA-256 integrity checks, sidecar manifests, and API/runtime wiring.
- `packages/worker-core`: first-party job leasing, worker dispatch, audit events, retries, stale-lock recovery, and dead-letter transitions.
- `packages/assessment-core`: answer scoring, false-confidence detection, failure modes, and user graph updates.
- `packages/sleep-core`: sleep cue packet selection with matched controls and rendered audio-plan metadata.
- `packages/video-core`: bounded GraphFeed ranking and watch packet generation.
- `packages/paced-reader-core`: graph-aware chunking and effective WPM calculations.
- `packages/technique-lab`: evidence registry and experiment templates for learning techniques.
- `packages/tutor-core`: first-party rubric semantics, tutor modes, and safety gates for feedback.
- `packages/social-core`: outcome-safe badges, challenges, privacy-aware dashboards, and contributor reputation.
- `packages/wearables-core`: optional wearable connection, token envelope, sleep normalization, readiness, and native-edge planning primitives.
- `packages/content-court`: proposal, voting, local arbitration, and first-party moderation triage primitives.
- `packages/audio-core`: deterministic audio timeline assembly for sparse sleep cue playback.
- `master-graph`: open master graph layout, seed packs, schemas, policies, and release notes.
- `services`: API, scheduler, audio-renderer, and worker services wired to the same shared models, including a first-party HTTP adapter with security headers, CSRF checks, rate limits, PWA offline-sync receipts, privacy export/deletion handlers, queued creator ingestion, queued notifications, queued local arbiter review, queued analytics rollups, queued moderation triage, queued export artifacts, and executable queue workers.
- `infra/docker`: local production-like Compose stack for Postgres, Redis, MinIO, API, scheduler, ingestion, audio, notification, local-AI, analytics, moderation, export workers, and shared object storage.

## Product Principles

- Learn any domain without hard-coding the app around one subject.
- Prefer retrieval, transfer, calibration, and screen efficiency over passive time in app.
- Treat sleep as protected. Night audio is sparse cue reactivation, not new teaching.
- Make every content object reviewable with public/auditable case files.
- Use experiments and within-user controls wherever possible.
- Keep popularity separate from truth. Votes prioritize review; evidence and audit decide claims.

## Development

```bash
npm install
npm run dev
npm run api:dev
npm run api:migrate
npm run verify
```

The dev server runs the PWA at the URL printed by Vite, normally `http://localhost:5173`.
The API server defaults to `http://localhost:8787` and can use memory or Postgres storage through `.env` settings.
Set `VITE_MNEMOSYNE_API_URL` and `VITE_MNEMOSYNE_USER_ID` to hydrate the PWA from the first-party app bootstrap route instead of the local demo seed.
When configured, the PWA uses the bootstrapped persisted goals, daily packet, and sleep audio plan as the primary Today, Forge, GraphFeed, WalkMode, Lock-In, and Sleep plan.
Morning Forge, WalkMode, and Evening Lock-In sync post backend-compatible queued responses directly to the first-party completion endpoints when API sync is configured, with the offline receipt route retained for legacy and receipt-only payloads.
`npm run verify` runs lint, typecheck, unit tests, production build, and dependency audit.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the path from the current foundation to the fully usable, production-ready Mnemosyne Engine.

## Safety Boundaries

Mnemosyne Engine does not recommend drug protocols. High-stakes domains such as medicine, law, finance, politics, public safety, weapons, self-harm, and drug use require source labels, review dates, disclaimers, and additional human/expert review before canonical status.

## Repository Status

The master graph is designed to be public/open-data by default. Personal user graphs, sleep data, health data, and raw voice recordings are private by default and should be stored minimally with explicit user consent.
