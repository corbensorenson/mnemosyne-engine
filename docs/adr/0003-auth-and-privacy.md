# ADR 0003: Auth and Privacy Direction

## Status

Accepted

## Context

Mnemosyne handles sensitive data: voice responses, sleep data, wearable tokens, learning weaknesses, and potentially high-stakes domains. The roadmap requires private-by-default user graphs, explicit sharing, deletion, export, and separate research consent.

## Decision

Use OAuth/passkey-ready authentication with server-side sessions and object-level authorization. Default every personal graph, voice, health, sleep, and session artifact to private. Store raw voice minimally, delete raw audio after transcription unless the user opts in, encrypt wearable tokens, and separate product analytics consent from research-grade experiment consent.

## Consequences

- Authorization must be enforced at every service boundary, not only in the UI.
- Data deletion and export become first-class product flows.
- Social and research features must request explicit scope rather than inheriting broad access.
- Production readiness requires security tests for privacy-sensitive objects.
