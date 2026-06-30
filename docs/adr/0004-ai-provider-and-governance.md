# ADR 0004: AI Provider and Governance Direction

## Status

Accepted

## Context

The AI tutor, assessment scorer, content ingestion pipeline, and Content Court agents are central to the roadmap. They must improve learning without becoming opaque or silently mutating canonical graph truth.

## Decision

Use first-party deterministic engines whenever the product behavior is simple enough to own directly. For genuinely model-backed work, use a provider-agnostic orchestration layer with structured inputs, structured outputs, schema validation, model/version logging, prompt/version logging, safety policy IDs, and audit events. AI may propose, score, summarize, and arbitrate, but canonical master graph changes require proposal records, source audits, verdict logs, and human override paths.

Queue and service names must distinguish local ownership from provider dependency. First-party model-adjacent jobs use the `local_ai` queue unless they truly require a remote provider adapter.

## Consequences

- Simple local engines remain owned in the repo instead of becoming unnecessary provider dependencies.
- The product can swap model providers without rewriting domain workflows when a provider-backed capability is justified.
- AI decisions become reviewable objects.
- High-risk domains can require stricter policies and human review.
- Evaluations for hallucination, answer leakage, unsafe advice, and over-teaching must be part of CI or release gates before broad launch.
