# First-Party Tutor Core

Mnemosyne's tutor layer starts with deterministic, first-party behavior. It does not require a hosted model provider to score a recall attempt, choose a tutor mode, or decide whether feedback is safe to apply to the learner graph. Model adapters can be added later behind the same contract, but the default path must remain auditable and testable.

## Package

`@mnemosyne/tutor-core` owns:

- tutor modes: Socratic, Examiner, Calm Coach, Debate Opponent, Language Partner, Debugger, Oral Board, Walk Coach, and Sleep Prep Guide
- rubric-aware semantic scoring against required terms, aliases, common failures, transfer signals, confidence, latency, hints, and retries
- mode-specific feedback, next prompt, hint, repair steps, and allowed next actions
- deterministic safety evaluation for answer leakage, hallucination-prone language, high-stakes unsafe advice, and over-teaching
- release gates that decide whether a tutor turn is safe to count as a compatible assessment event

The package deliberately keeps feedback concise and asks before teaching. That keeps the tutor aligned with test-before-teach loops instead of letting explanations replace retrieval.

## API

`POST /api/tutor/turn` accepts:

- `userId`
- `mode`
- `item`
- `rawResponse`
- optional `confidence`, `hintCount`, and `retries`
- `latencyMs`
- `entryMode`
- optional transcript plus transcript-retention policy
- `highStakesDomain`

The handler builds a tutor turn, converts it into a normal `AssessmentResponse`, records `assessment_answered`, audits `tutor_turn_scored`, and updates graph state only when the tutor release gate passes.

The PWA Tutor surface uses the same first-party package in-browser, applies local graph progress only after the release gate passes, and queues backend-compatible turns directly to `POST /api/tutor/turn` when API sync is configured.

## Safety Rules

A tutor turn is blocked from graph mutation when the release gate fails. The current gate checks:

- answer leakage risk stays below threshold
- high-stakes unsafe advice stays below threshold
- hallucination-prone language is absent
- feedback is concise
- the turn remains compatible with assessment-event analytics

Blocked turns are still persisted and audited so developers can inspect what happened without silently advancing mastery.

## Privacy

Voice and text tutor turns use the same privacy posture as WalkMode and session answers. Transcript storage is explicit:

- `deleted`: do not store transcript text in the learning event payload
- `transcript_only`: store transcript text for review/export/deletion
- `retained`: reserve for flows where the user has opted in to broader retention

Voice deletion already scrubs transcript-like payload keys during scoped privacy deletion.

## Future Provider Adapters

Any model-backed tutor adapter should return the same `TutorTurnPlan` shape and pass the same release gate before its output can update graph state. Provider name, model version, prompt version, and policy id should be added to audit payloads before production use.
