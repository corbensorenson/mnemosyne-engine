# Mnemosyne Engine Roadmap

## Active Project Goal

Complete Mnemosyne Engine as a fully usable, production-ready, graph-governed, voice-first, sleep-augmented learning operating system.

The finished product must let a learner choose a capability target, diagnose what they know, generate daily training packets, run morning and evening sessions, learn through bounded video, recall while walking, prepare sleep-safe cue reactivation, measure outcomes against controls, improve the personal graph, improve the public master graph, and audit every content or AI governance decision.

This roadmap is intentionally ambitious. The goal is not to polish a demo. The goal is to turn the current foundation into a coherent platform whose learning behavior can be measured, trusted, deployed, and improved.

## Definition of Done

Mnemosyne Engine is "fully usable and completed" when all of these are true:

- A real user can sign up, define goals, install packs, and use the system daily without developer intervention.
- The scheduler generates useful Morning Forge, GraphFeed, WalkMode, Evening Lock-In, and Night Reactivation packets from persistent user data.
- Every session records events, assessments, graph updates, screen load, confidence, latency, and retention outcomes.
- The personal graph is private by default, exportable, deletable, and updated by real performance.
- The master graph has public schemas, seed packs, governance workflows, proposal review, verdict logging, versioned releases, and case files.
- Voice capture, text fallback, audio playback, first-party Flash, bounded video, and sleep cue planning work on the PWA.
- Sleep features remain conservative: sparse cue replay, matched controls, stop conditions, and no claims of learning complex new material while asleep.
- At least one wearable or sleep-data integration path is functional.
- The backend has authentication, persistence, authorization, audit logs, queues, object storage, analytics, and deployment automation.
- Security, privacy, accessibility, and high-stakes-domain safety gates pass.
- Learning quality is evaluated with immediate, 24h, 7d, and 30d metrics.
- The public release includes docs, onboarding, operations runbooks, test coverage, and production monitoring.

## Current Baseline

The repository already has the first foundation:

- TypeScript monorepo and MIT license.
- PWA shell with Today, Graph, Forge, Cinema, Walk, Lock-In, Sleep, Stats, Packs, Court, Lab, and Admin surfaces.
- Shared schemas for graph, user state, sessions, video, sleep, governance, experiments, and events.
- Core packages for graph analysis, scheduling, assessment scoring, sleep packets, audio timelines, video ranking, the first-party Flash engine, Technique Lab, and Content Court.
- Seed master graph layout, schemas, packs, arbiter policy, source rubric, and release notes.
- API, scheduler, and audio-renderer service skeletons.
- Docker dev infra and starter unit tests.

## Operating Principles

- Build vertical slices that attach to the same graph, event, assessment, and experiment layers.
- Prefer evidence-backed learning techniques over novelty.
- Measure durable mastery, transfer, latency, calibration, cue gain, screen efficiency, and sleep integrity.
- Do not reward passive watch time, screen time, or easy quiz grinding.
- Keep every claim, cue, quiz, video, definition, and learning path reviewable.
- Treat AI as auditable infrastructure, not an opaque authority.
- Design the PWA to disappear when audio, voice, walking, or sleep cueing is the better interface.
- Make privacy and deletion first-class, especially for voice, sleep, and health data.

## Release Tracks

### Track A: Product App

Deliver the learner-facing PWA from polished prototype to daily-use application.

1. Replace demo-only state with authenticated persisted state.
2. Build onboarding for goals, packs, modality preferences, readiness, and privacy consent.
3. Implement real session players for Morning Forge, GraphFeed, WalkMode, Evening Lock-In, Flash, and Sleep.
4. Add offline lesson-packet cache, IndexedDB queueing, and sync recovery.
5. Add responsive accessibility passes: keyboard navigation, screen reader labels, reduced motion, contrast, and text scaling.
6. Add settings for voice retention, sleep data, research consent, sharing, and notifications.
7. Add empty states, loading states, error states, and recovery flows.

### Track B: Backend Platform

Turn service skeletons into a deployable system.

1. Choose and lock backend framework conventions.
2. Add Postgres schema and migrations for users, goals, concepts, states, events, sessions, assessments, proposals, votes, audio plans, and packs.
3. Add object storage for audio, transcripts, uploaded files, generated assets, and exports.
4. Add Redis-backed queues for ingestion, AI jobs, audio rendering, notification scheduling, and analytics processing.
5. Add authentication with OAuth/passkeys-ready architecture.
6. Add object-level authorization and role-based access control.
7. Add API validation using the shared schema package.
8. Add event ingestion, event replay, audit logging, and analytics rollups.
9. Add deployment environments: local, staging, production.

### Track C: Graph and Learning Engine

Make the graph engine empirically useful.

1. Implement persistent master graph and personal graph services.
2. Add graph import/export and pack installation.
3. Add prerequisite traversal, path planning, blocked-path detection, and graph-delta estimation.
4. Add adaptive spacing with stability, recall strength, transfer score, and deadline pressure.
5. Add concept windows: known, decaying, frontier, horizon, blocked.
6. Add misconception tracking and failure-mode repair plans.
7. Add graph versioning, release channels, and user graph migration.
8. Add evaluation jobs that compare predicted graph gains with actual outcomes.

### Track D: Assessment and Tutor

Move from local heuristic scoring to robust multimodal assessment.

1. Expand assessment types: free recall, short answer, multiple choice, forced discrimination, pronunciation, translation, timeline ordering, graph reconstruction, sketch, debugging, simulation, boss fight, and transfer.
2. Add rubric authoring and validation.
3. Add semantic scoring with AI-assisted rubric checks and deterministic guardrails.
4. Add voice transcription, latency capture, confidence prompts, and calibration scoring.
5. Add tutor modes: Socratic, Examiner, Calm Coach, Debate Opponent, Language Partner, Debugger, Oral Board, Walk Coach, and Sleep Prep Guide.
6. Add test-before-teach loops, hint ladders, misconception detection, and explanation repair.
7. Add session transcripts and privacy-aware deletion policies.
8. Add tutor evaluations for hallucination, over-explanation, answer leakage, and high-stakes safety.

### Track E: Voice, Audio, WalkMode, and Flash

Make low-screen learning excellent.

1. Add speech recognition integration with text fallback.
2. Add TTS or generated audio for prompts, feedback, phrase shadowing, and sleep cue preview.
3. Add Media Session controls and lock-screen friendly playback.
4. Add WalkMode state machine: prompt, listen, score, hint, retry, skip, mark confusing, complete.
5. Add voice commands and wake-safe command handling.
6. Add first-party Flash player with chunk display, speed controls, pause/rewind, ORP/highlight modes, comprehension gates, and strain rating.
7. Add SpeedListen sessions with comprehension and retention checks.
8. Add audio accessibility and quiet-environment fallbacks.

### Track F: SleepCue Engine

Make Night Reactivation safe, measurable, and conservative.

1. Persist sleep cue templates, packets, controls, audio plans, and playback events.
2. Render deterministic all-night audio files or deterministic playlists.
3. Add sparse cue spacing, max cue density, fade curves, silence windows, volume normalization, and stop conditions.
4. Add matched cued vs uncued concept assignment.
5. Add morning recall tests that compare cue gain.
6. Add user sleep reports and wearable sleep-stage imports.
7. Add safety monitors for fatigue, wake reports, poor sleep, emotional activation, and insomnia risk.
8. Add hard product copy constraints: no sleep-upload claims, no loud lecture streams, no drug recommendations.

### Track G: GraphFeed and Content Ingestion

Replace random educational scrolling with bounded graph-curated learning.

1. Add YouTube embed/API-compliant video playback.
2. Add transcript ingestion and chapter mapping.
3. Add video-to-concept mapping, prerequisite checks, recall prompts, Flash recaps, and sleep-safe cue suggestions.
4. Add creator upload/link workflows.
5. Add sponsor-noise, misinformation-risk, cognitive-load, and screen-efficiency scoring.
6. Add bounded packet UX with no infinite scroll by default.
7. Add post-watch recall and WalkMode handoff.
8. Add outcome-based video ranking.

### Track H: Content Court and Master Graph Governance

Make the public graph trustworthy and improvable.

1. Build proposal creation, diff views, object case files, voting, comments, and appeal flows.
2. Add AI court agents: Extractor, Source Auditor, Ontology Auditor, Pedagogy Auditor, Expert Critic, Beginner Critic, Bias/Dispute Critic, Safety Critic, Outcome Analyst, and Arbiter.
3. Add source auditing and required evidence rules.
4. Add human moderation, overrides, freezes, reverts, and public reasons.
5. Add release process: regression checks, source audit, learning path impact analysis, version bump, release notes.
6. Add public graph browsing and pack downloads.
7. Add contributor reputation based on accepted, outcome-positive contributions.

### Track I: Experiment and Personalization Engine

Make the platform self-improving.

1. Persist technique, content, path, sleep cue, video, Flash, audio-speed, gamification, and typography experiments.
2. Add within-user matched controls by concept, cue, content object, and session.
3. Add assignment strategies: random, stratified, within-user matched, and multi-armed bandit.
4. Add outcome metrics: immediate recall, 24h, 7d, 30d, transfer, latency, calibration, sleep disruption, screen efficiency, preference.
5. Add personalization profiles: technique response, modality response, sleep cue response, video preference, screen tolerance, voice tolerance, walking profile, Flash profile, domain profile, time-of-day profile.
6. Add experiment dashboards and automated deprecation of harmful or ineffective variants.

### Track J: Social, Badges, and Creator Studio

Make the product sticky without rewarding hollow activity.

1. Add privacy-preserving friend profiles and share levels.
2. Add challenges: retention duel, boss fight, screen-efficiency challenge, walk recall challenge, same-video recall duel, and sleep-cue gain challenge.
3. Add badges for consistency, depth, breadth, retention, speed, sleep, voice-only, screen efficiency, creator quality, and hard mode.
4. Add creator studio for videos, definitions, quizzes, cues, examples, and learning paths.
5. Add contributor workflows that route everything through Content Court.
6. Add anti-gaming controls that avoid raw time-in-app rewards.

### Track K: Wearables and Native Edge

Bridge device APIs that the PWA cannot reliably own.

1. Add capability detection and provider status surfaces.
2. Add Oura OAuth integration as the first wearable path.
3. Add native-edge companion plans for HealthKit, Health Connect, background audio, Bluetooth/EEG, watch haptics, and local notifications.
4. Add sleep-session and sleep-stage import normalization.
5. Add privacy controls and token encryption for health data.
6. Add graceful fallback when no wearable is connected.

### Track L: Security, Privacy, Compliance, and Operations

Make the system safe to run for real people.

1. Threat model voice, health, sleep, AI, graph governance, and creator ingestion flows.
2. Add CSP, CSRF protection, rate limits, input validation, output validation, and audit logs.
3. Add encrypted secrets and health tokens.
4. Add data export, account deletion, health data deletion, sleep data deletion, and raw voice deletion flows.
5. Add consent separation for product analytics and research-grade experiments.
6. Add high-stakes domain policies and UI labels.
7. Add backups, migrations, observability, alerting, runbooks, and incident response.
8. Add dependency scanning and security tests in CI.

## Milestones

### Milestone 0: Foundation Stabilization

Goal: make the current repo reliable for continued development.

Deliverables:

- [x] CI for install, typecheck, unit tests, build, lint, dependency audit.
- [x] Lint rules.
- [x] Test data fixtures separated from app code.
- [x] Formatting rules.
- [x] Storybook or component workbench for core UI states.
- [x] Issue templates and contribution labels.
- [x] Architecture decision records.

Exit criteria:

- Fresh clone can run `npm install`, `npm run verify`, and `npm run dev`.
- CI is green on `main`.
- Roadmap is linked from README.

### Milestone 1: Real Persistence and API

Goal: replace demo-only state with durable data.

Deliverables:

- [x] Postgres schema and migrations.
- [x] API service with route handlers for users, goals, graph, daily packets, sessions, assessments, packs, and proposals.
- [x] API service route handlers for sleep, videos, wearables, and moderation actions.
- [x] API service route handlers for creator ingestion.
- [x] Shared schema validation at API boundaries.
- [x] Event log and audit log tables.
- [x] Seed loader for master graph packs.
- [x] Local Docker dev environment.

Exit criteria:

- A demo user can be created, goals saved, packs installed, and daily packets regenerated from database state.
- Events persist and can be replayed into user graph state.

### Milestone 2: Learner Onboarding and Goal Planning

Goal: make first use coherent.

Deliverables:

- Account/session flow.
- Goal creation wizard.
- Pack selection and installation.
- Baseline diagnostic assessments.
- Modality, privacy, and research consent setup.
- Device capability detection.

Current implementation progress:

- API onboarding completion flow creates a private-default user, saves the first goal, installs selected packs, seeds baseline graph states, generates diagnostic assessment items, and persists the first daily packet with audit and event records.
- First-party auth core and API handlers now issue passkey/OAuth/dev sessions with hashed session tokens, hashed CSRF tokens, optional device binding, object-level authorization decisions, security posture summaries, and audit events.
- PWA onboarding surface starts first-run users in a goal, pack, modality, privacy, device capability, and diagnostic setup flow before handing off to the first daily packet.

Exit criteria:

- A new user can go from empty account to first daily packet in under 10 minutes.
- User data sharing defaults to private.

### Milestone 3: Morning Forge MVP-Plus

Goal: ship a genuinely useful morning training loop.

Deliverables:

- Session player with cold retrieval, error repair, frontier push, horizon preview, and cue preview.
- Text and voice answer entry.
- Confidence and latency capture.
- Scoring and graph updates.
- Failure-mode repair recommendations.
- Offline packet cache.

Current implementation progress:

- API Morning Forge completion flow scores text/voice-compatible responses, captures confidence, latency, screen minutes, updates graph states, persists assessment responses, completes the session, and records audit/event trails with repair recommendations.
- PWA Morning Forge session surface now queues cold retrieval and transfer prompts, captures text or voice-mode answers, tracks confidence and latency, shows repair recommendations, previews frontier/horizon/cue targets, and writes a compact offline packet cache.

Exit criteria:

- Morning session completion updates user graph and schedules next reviews.
- Session works with voice unavailable.

### Milestone 4: Evening Lock-In and Phone-Down Mode

Goal: make evening consolidation low-screen and sleep-preserving.

Deliverables:

- Evening audio-first session player.
- Dusk restrictions.
- Transfer drills.
- Sleep cue binding flow.
- Phone-down ritual and local reminder.

Current implementation progress:

- API Evening Lock-In completion flow scores recall and transfer responses, records phone-down readiness and cue bindings, completes the session, and generates a fresh SleepCue packet plus audio plan from evening bindings and graph state.
- PWA Evening Lock-In surface now runs an audio-first low-screen prompt queue, captures voice/text answers with confidence and latency, binds sleep cues, tracks the phone-down checklist, previews the generated sleep handoff, and caches the handoff locally.

Exit criteria:

- Evening session can be completed with minimal screen interaction.
- Sleep packet is generated from evening cue bindings and graph state.

### Milestone 5: SleepCue Alpha

Goal: ship conservative, measurable Night Reactivation.

Deliverables:

- Sleep cue packet persistence.
- Deterministic audio render manifest and generated audio asset.
- Playback event logging.
- Morning cued vs uncued recall tests.
- Stop condition reporting.
- Sleep safety dashboard.

Current implementation progress:

- API SleepCue playback flow logs played cue events, bucket counts, stop conditions, disruption reports, completed sleep sessions, and audit records against persisted sleep packets.
- API next-morning SleepCue recall flow scores cued and matched-control prompts, reveals control comparison in results, updates graph state with `sleep_replays` and `cue_gain_estimate`, and records event/audit trails.
- PWA Sleep surface now lets a learner start and log Night Reactivation, set stop conditions and sleep-disruption status, run a next-morning recall check, and view cue-gain comparison with matched controls revealed only in results.

Exit criteria:

- User can run a sleep packet and see next-morning cue-gain comparison.
- Controls are hidden during assignment but visible in results.

### Milestone 6: GraphFeed and Flash

Goal: turn video and fast reading into active graph work.

Deliverables:

- Bounded video packets.
- YouTube embed player.
- Transcript/chapter metadata model.
- Post-watch recall generator.
- First-party Flash player with comprehension gate.
- WalkMode handoff after video.

Current implementation progress:

- PWA GraphFeed runs as a bounded local session with selected packet videos, chapter metadata, transcript IDs, post-watch recall scoring, local cache, and WalkMode handoff only after recall passes.
- First-party watch completion logs `video_watched` for audit but awards graph progress only when post-watch recall passes; failed recall keeps the watch out of concept progress.
- First-party Flash engine selects graph-aligned assets, builds chunked session plans with display-unit controls, and reports estimated effective WPM with the comprehension gate.
- PWA Flash player runs locally in the browser with chunk display, WPM controls, pause/rewind/skip, completion gate, strain rating, local cache, and graph-state updates without a third-party service.
- Optional first-party persistence endpoints record effective WPM, comprehension, retention, strain, screen load, and gated advancement; completion logs `flashread_completed`, audits the result, and updates concept graph state only when the comprehension/strain gate allows progress.

Exit criteria:

- Video only counts toward progress after recall.
- Flash reports effective WPM, not raw speed.

### Milestone 7: WalkMode and Voice Tutor

Goal: make screen-locked recall a first-class daily mode.

Deliverables:

- Voice command handling.
- Prompt playback and answer capture.
- Tutor feedback modes.
- Semantic scoring path.
- Misconception repair.
- Privacy controls for voice deletion.

Current implementation progress:

- PWA WalkMode now runs a first-party prompt/listen/score/hint/skip/mark-confusing/complete state machine with screen-locked phone controls, text fallback, voice transcript entry, command log, repair feedback, local cache, and transcript deletion controls.
- First-party WalkMode completion persists voice and text answers through the same assessment response path, logs compatible `assessment_answered` events, records `walk_recall_completed`, marks confusing prompts for repair, and supports deleted transcript retention.

Exit criteria:

- User can complete a WalkMode session with the screen locked or glance-only.
- Voice and text paths produce compatible assessment events.

### Milestone 8: Content Court Alpha

Goal: make content reviewable and governable.

Deliverables:

- Case file pages for claims, concepts, cues, assessments, videos, and definitions.
- Proposal diff UI.
- Voting and comment flows.
- AI arbiter job runner.
- Human moderation override.
- Release notes generator.

Current implementation progress:

- PWA Content Court case file shows proposal rationale, affected objects, source/risk metrics, before/after diff, vote controls, comments, arbiter review, moderation accept, release action, and generated release notes.
- First-party proposal lifecycle supports vote, comment, AI review, human override, and release endpoints; accepted definition changes can update the master graph, mark the proposal merged, and emit a graph-release audit artifact with graph version and release notes.

Exit criteria:

- A content change can move from proposal to verdict to released graph version with audit trail.

### Milestone 9: Experiment and Personalization Alpha

Goal: start measuring what actually works.

Deliverables:

- Experiment assignment engine.
- Within-user matched control assignment.
- Technique response profile updates.
- Outcome rollups.
- Personalization dashboard.

Current implementation progress:

- First-party Technique Lab experiment engine seeds three technique experiments plus a sparse SleepCue protocol, assigns deterministic within-user matched treatment/control units, rolls up correctness, latency, calibration, screen efficiency, and cue-gain outcomes, and emits scheduler adjustment recommendations.
- API Technique Lab flow persists experiments, matched assignments, personalization profiles, and audits assignment decisions; daily packet generation now consumes saved response profiles to adjust Morning screen budget, GraphFeed watch budgets, evening screen policy, and conservative sleep mode.
- PWA Lab surface shows the personalization profile, modality response scores, sleep cue gain, effect-vs-control rollups, matched assignment ledger, and the scheduler changes generated from observed local outcomes.
- First-party Outcome core now builds immediate, 24h, 7d, and 30d outcome dashboards from assessment responses, learning events, and graph state; API refresh persists dashboards, audits quality gates, and includes dashboards in user exports.

Exit criteria:

- At least three techniques and one sleep cue protocol can be compared against controls.
- Scheduler changes behavior based on observed response profiles.

### Milestone 10: Social and Creator Beta

Goal: add growth loops without corrupting learning incentives.

Deliverables:

- Friends and share levels.
- Challenge creation and scoring.
- Badges tied to durable outcomes.
- Creator upload/link flow.
- Contributor reputation and moderation queue.

Current implementation progress:

- First-party Social core scores retention duels, boss fights, screen-efficiency challenges, walk recall, same-video recall, SleepCue gain, and creator-quality challenges using durable outcome metrics only; raw app time and raw video time are explicitly blocked by challenge validation and anti-gaming policy.
- API social flow now supports privacy-aware dashboards, challenge creation/listing, outcome badge evaluation/persistence, and contributor reputation based on accepted or merged Content Court contributions, evidence quality, disputes, and outcome-positive release notes.
- PWA Social surface shows share level, visible badge/challenge counts, anti-gaming guardrails, outcome badges, challenge scoreboards, and creator reputation without exposing private graph details.

Exit criteria:

- Social features reward retention, transfer, consistency, screen efficiency, sleep integrity, or contribution quality.
- No primary reward is based on raw app time or raw video time.

### Milestone 11: Wearables and Native Edge

Goal: integrate sleep data without making the web app brittle.

Deliverables:

- Oura integration.
- Sleep data normalization.
- Capability dashboard.
- Native-edge technical design for HealthKit and Health Connect.
- Token encryption and revocation.

Current implementation progress:

- First-party `@mnemosyne/wearables-core` package now owns Oura authorization request construction, token exchange descriptors, AES-GCM token envelopes, revocation records, sleep-stage normalization, readiness adjustment, provider status, and native-edge planning.
- API wearable flows now support Oura connect, wearable status, sleep sync, encrypted token storage, revocation, normalized sleep persistence, readiness updates, and audit events.
- PWA Wear surface shows provider status, optional Oura authorization, manual fallback, synced sleep-stage totals, readiness impact, HealthKit/Health Connect native companion plan, and token control without storing provider tokens in browser state.
- Native-edge design doc covers HealthKit, Health Connect, background audio, local notifications, watch haptics, token handling, fallback rules, and the boundary between native bridges and first-party learning logic.
- Unit coverage verifies Oura connect, encrypted token envelopes, normalized deep/REM sleep stages, readiness updates, persisted wearable sleep sessions, local token clearing on revoke, provider status, and audit trail.

Exit criteria:

- Sleep sessions can be enriched with wearable sleep data or fall back gracefully without it.

### Milestone 12: Public Production Release

Goal: ship the platform to real users.

Deliverables:

- Production deployment.
- Monitoring, alerting, backups, and incident response.
- Security review and dependency scanning.
- Accessibility review.
- Load and reliability testing.
- Public docs and user guides.
- Admin moderation tools.
- Data export and deletion.

Current implementation progress:

- GitHub repository visibility is public and GitHub license detection reports MIT.
- API privacy flow now supports user data export and scoped deletion for voice, sleep, health, and full account data with explicit confirmation, deletion summaries, and retained audit events.
- Persistence layer can produce export bundles across user profile, goals, graph state, packets, sessions, events, experiments, social state, and wearable data, while account deletion removes user-owned records and anonymizes retained audit entries.
- PWA Admin surface includes Privacy Ops cards for export, voice deletion, health deletion, and account deletion alongside the service map and audit log.
- Security foundation now includes `@mnemosyne/auth-core` for RBAC, object-level authorization, consent-aware analytics access, CSRF verification, session expiry, and API audit trails for auth decisions.
- Outcome analytics now exposes `GET /api/outcomes/dashboard` and `POST /api/outcomes/refresh` with quality gates for immediate recall, 24h recall, 7d recall, 30d recall, transfer, latency, calibration, screen load, and SleepCue controls.
- Production release runbook covers deployment environments, required services and secrets, monitoring, backup/restore, accessibility, load/reliability, and release checklist.
- Privacy documentation covers export bundle contents, deletion scopes, audit rules, product requirements, and test coverage.

Exit criteria:

- A real user can safely use the app for 30 consecutive days.
- The system reports learning outcomes at immediate, 24h, 7d, and 30d windows.
- The team can operate, debug, moderate, and improve the platform.

## Cross-Cutting Quality Gates

### Functional Gates

- Generate daily packet.
- Run Morning Forge.
- Score text and voice answers.
- Update user graph.
- Recommend GraphFeed videos.
- Generate post-video recall.
- Run WalkMode.
- Run Evening Lock-In.
- Generate sleep cue packet.
- Render sleep audio.
- Compare cued vs uncued retention.
- Show personal graph.
- Score and rank content objects.
- Accept content proposals.
- Run AI arbitration.
- Allow human override.
- Generate stats and badges.
- Support PWA install/offline basics.
- Integrate at least one wearable path.

### Learning Gates

- Immediate recall measured.
- 24h recall measured.
- 7d recall measured.
- 30d recall measured.
- Transfer measured.
- Latency measured.
- Confidence calibration measured.
- False confidence tracked.
- Screen load tracked.
- Sleep effect measured with controls.

### Governance Gates

- Case files visible.
- AI verdicts logged.
- Source audits attached.
- Proposal diffs preserved.
- Graph changes versioned.
- Dispute status supported.
- Human override supported.
- Release notes generated.

### Safety and Privacy Gates

- Private by default.
- Explicit sharing controls.
- Data export and deletion.
- Raw voice deletion.
- Sleep and health data deletion.
- Token encryption.
- High-stakes domain labels.
- No drug-protocol recommendations.
- No sleep-upload marketing claims.

### UX Gates

- Screen-off Morning Walk support.
- Audio-first Evening Lock-In.
- Bounded GraphFeed packets.
- Flash with comprehension gate.
- Phone-down ritual.
- Graph exploration.
- Friend challenges.
- Admin and creator workflows.

## Suggested Execution Rhythm

Use two-week implementation cycles:

1. Pick one vertical slice and one infrastructure slice.
2. Define measurable acceptance tests before implementation.
3. Build against shared schemas.
4. Add events and audit logs while building the feature, not after.
5. Add tests for core engine behavior.
6. Run browser checks for desktop and mobile.
7. Update roadmap status and release notes.

Recommended first cycles:

- Cycle 1: CI, lint, fixtures, README roadmap link, API framework decision.
- Cycle 2: Postgres schema, migrations, seed loader, route validation.
- Cycle 3: persisted users/goals/packs/daily packets.
- Cycle 4: real Morning Forge session events and graph updates.
- Cycle 5: evening and sleep packet persistence.

## First Engineering Tasks

1. Add CI and linting.
2. Extract demo data into reusable fixtures.
3. Add ADRs for backend framework, database schema, AI provider abstraction, and auth strategy.
4. Implement database schema and migrations.
5. Implement API server routes behind shared validation.
6. Add persistent daily-packet generation.
7. Add event replay into user concept state.
8. Add onboarding wizard.
9. Add session persistence and completion events.
10. Add sleep audio render worker interface.

## Risks to Watch

- Building too many surfaces before persistence is real.
- Letting AI outputs mutate canonical graph state without audit.
- Treating sleep audio as teaching rather than reactivation.
- Optimizing for streaks or content consumption instead of durable mastery.
- Failing to distinguish personal/private graph data from public master graph data.
- Making voice and health data retention too casual.
- Letting high-stakes content become canonical without review.
- Underinvesting in data deletion, export, and consent.

## North Star

Every day, Mnemosyne Engine should answer:

- What does this user want to become capable of?
- What does this user actually know?
- What is decaying?
- What is blocking progress?
- What should be retrieved this morning?
- What should be learned today?
- What should be watched instead of random scrolling?
- What should be recalled while walking?
- What should be locked in tonight?
- What should be replayed during sleep?
- What should be tested tomorrow?
- Which content actually worked?
- Which technique actually worked?
- Which path should future users take?

If a feature does not improve the user graph, master graph, content rankings, technique evidence, sleep cue model, learning path model, social learning layer, or arbiter decision quality, it should be questioned before it is built.
