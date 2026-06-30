# Security Release Gates

Mnemosyne keeps security policy in first-party code so production deployment does not depend on each route remembering a local convention. `@mnemosyne/security-core` owns the reusable contract for HTTP headers, rate-limit profiles, high-stakes content labels, and release gates.

## Current Package

`@mnemosyne/security-core` provides:

- Content Security Policy and browser hardening headers
- default rate-limit profiles for auth, tutor turns, proposals, creator ingestion, privacy export, wearable sync, and service jobs
- high-stakes content classification for medical, legal, financial, political, public-safety, weapons, self-harm, and drug-use domains
- release gates that verify CSP presence, CSRF expectation, expensive-path rate limits, high-stakes labels, expert-review requirements, and audit payload safety

## API Surface

The API service exposes:

- `GET /api/security/release-gate`

The handler returns the security headers, rate-limit policy count, and release-gate result. It also audits `security_release_gate_checked`.

The API package also exports a first-party Node HTTP adapter:

- `createApiHttpHandler`
- `createApiHttpServer`
- `createSeededDemoApiHttpServer`

The adapter attaches the security headers to every response, parses bounded JSON request bodies, maps route parameters onto handler inputs, enforces CSRF headers for mutating production requests, and returns stable JSON envelopes for handler, validation, route, rate-limit, and server errors.

## High-Stakes Content

Proposal creation and creator ingestion now classify submitted content before it can enter Content Court. If high-stakes content is detected:

- proposal risk is elevated to at least `high`
- proposal status becomes `human_review_required`
- required labels are attached to the proposal diff under `security_review`
- `POST /api/proposals/:id/moderation/jobs` can queue first-party moderation triage for the proposal
- learning events and audit events include high-stakes domains, risk score, required labels, and review requirements
- canonical graph release remains blocked until review resolves the proposal

Tutor turns also classify prompt and response text. High-stakes context is passed into tutor safety evaluation even when a client forgets to mark the turn as high-stakes.

## Rate Limits

The current package returns deterministic policy definitions, and the first-party HTTP adapter enforces these profiles before expensive or abuse-prone work:

- auth session issuance
- tutor turns
- proposal creation
- creator ingestion
- privacy export
- wearable sync
- service job operations

External adapters should use the same policy keys so audit dashboards and incident response can compare local, staging, and production behavior.

## Audit Safety

Security release gates fail when audit payloads contain token-like or secret-like fields such as session tokens, CSRF tokens, access tokens, refresh tokens, passwords, secrets, or private keys.
