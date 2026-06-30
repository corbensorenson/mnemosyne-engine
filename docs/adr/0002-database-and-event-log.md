# ADR 0002: Database and Event Log Direction

## Status

Accepted

## Context

The product requires private personal graphs, public master graph releases, assessment history, sleep cue measurements, proposal audit trails, and outcome analytics. These workflows need relational consistency and replayable events.

## Decision

Use Postgres as the canonical database, with an append-only learning event log and audit log. Store canonical entities relationally, store event payloads as validated JSON, and derive user graph state from current rows plus replayable learning events. `@mnemosyne/replay-core` owns the first implementation of replaying persisted assessment responses and learning events into touched personal graph state. Add Redis-backed queues for async work and object storage for audio, transcript, video-derived, and export artifacts.

## Consequences

- Product data can be queried and audited with strong consistency.
- Learning outcomes can be recomputed as scoring models improve.
- Governance and user-privacy events remain inspectable.
- Graph database or vector search can be added later for specialized traversal and semantic lookup without replacing the canonical store.
