# Wearables and Native Edge

Mnemosyne keeps the learning engine first-party. Wearables are optional context sources for sleep timing, sleep stages, fatigue, and wake-safety signals. The PWA owns consent, normalization, safety policy, scheduling, and fallback behavior.

## Provider Scope

### Oura

Oura is the first external wearable provider because it has an OAuth path and returns sleep/readiness context that can enrich Night Reactivation. The integration stores only encrypted token envelopes and normalized sleep summaries in Mnemosyne data structures.

Current first-party surfaces:

- `@mnemosyne/wearables-core` builds Oura authorization requests, token exchange descriptors, encrypted token envelopes, revocation records, normalized sleep sessions, readiness adjustments, and capability dashboards.
- `POST /api/wearables/oura/connect` creates an authorization-required or connected Oura record.
- `POST /api/wearables/sync` imports raw provider sleep data, normalizes stages, saves a wearable sleep session, and updates readiness.
- `POST /api/wearables/:id/revoke` clears local access and refresh token envelopes.
- `GET /api/wearables/status` returns device capabilities, provider status, latest normalized sleep, readiness adjustment, and native-edge plan.
- The PWA Wear tab exposes provider status, sleep import, native edge readiness, and token control.

Oura remains optional. Mnemosyne must continue to run with manual sleep reports and local fallback status when no wearable is connected.

## Normalization Contract

Raw provider input is normalized before it can influence scheduling:

- Sleep stages normalize to `awake`, `light`, `deep`, `rem`, or `unknown`.
- Stage durations accept minute, second, or timestamp-bounded inputs.
- Sleep quality is clamped to `0..1` and can be inferred from efficiency plus deep/REM ratio when a direct score is missing.
- Fatigue is clamped to `0..1` and inferred conservatively when absent.
- Readiness changes are stored as a normal `ReadinessProfile` update with source notes.

Night Reactivation must only consume normalized sleep summaries, not provider-specific raw records.

## Token Handling

Wearable connection secrets are never stored as plaintext.

- Access and refresh tokens are encrypted with PBKDF2-derived AES-GCM envelopes.
- Envelopes include ciphertext, IV, salt, key hint, and creation time.
- Revocation clears both local token envelopes and records `revoked_at`.
- Audit events record status, provider, encryption presence, and local deletion, not raw token values.
- Browser demo connections do not place wearable tokens in local React state.

Production deployments should back the encryption secret with managed secrets storage and rotate provider client secrets outside application code.

## Native Edge Boundary

The web app should own graph logic, learning sessions, privacy policy, and audit history. Native companions should only bridge APIs that PWAs cannot reliably access.

### iOS Companion

Primary bridge responsibilities:

- HealthKit sleep session and stage import.
- Background audio handoff where web playback is unreliable.
- Local notifications for phone-down and morning recall.
- Apple Watch haptics for wake-safe cue stop signals.

The iOS companion should send normalized or minimally raw sleep payloads into the same API path used by Oura, then let the server normalize and audit the result.

### Android Companion

Primary bridge responsibilities:

- Health Connect sleep session and stage import.
- Background audio service handoff.
- Exact local notifications where permitted.
- Wear OS haptics for cue stop signals.

The Android companion follows the same API contract as iOS: no scheduler fork, no private graph copy, and no provider-specific learning logic.

## Capability Dashboard

The dashboard reports:

- PWA capabilities: push, background audio, microphone, offline cache.
- OS health bridges: HealthKit and Health Connect availability.
- Provider status: Oura, HealthKit, Health Connect, and manual fallback.
- Latest normalized sleep summary.
- Readiness adjustment notes.
- Native companion recommendations.

This keeps unsupported device paths explicit without blocking core learning.

## Fallback Rules

- If no wearable is connected, manual sleep logging remains available.
- If a provider is revoked, the app must not reuse stale provider tokens.
- If sleep quality is poor, fatigue is high, or a disruption is reported, SleepCue should become conservative or skip playback.
- If native background audio is unavailable, the web audio plan can still be rendered and logged manually.

## Test Coverage

The unit suite covers Oura connection creation, encrypted token envelopes, sleep stage normalization, readiness update, persisted wearable sleep sessions, local token clearing on revoke, provider status, and audit events.
