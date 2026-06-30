# ADR 0004: AI Provider and Governance Direction

## Status

Accepted

## Context

The AI tutor, assessment scorer, content ingestion pipeline, and Content Court agents are central to the roadmap. They must improve learning without becoming opaque or silently mutating canonical graph truth.

## Decision

Use a provider-agnostic AI orchestration layer with structured inputs, structured outputs, schema validation, model/version logging, prompt/version logging, safety policy IDs, and audit events. AI may propose, score, summarize, and arbitrate, but canonical master graph changes require proposal records, source audits, verdict logs, and human override paths.

## Consequences

- The product can swap model providers without rewriting domain workflows.
- AI decisions become reviewable objects.
- High-risk domains can require stricter policies and human review.
- Evaluations for hallucination, answer leakage, unsafe advice, and over-teaching must be part of CI or release gates before broad launch.
