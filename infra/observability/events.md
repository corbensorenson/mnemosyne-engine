# Event Taxonomy

Every meaningful action emits a learning or governance event:

- `session_started`
- `concept_seen`
- `assessment_answered`
- `cue_bound`
- `sleep_cue_played`
- `video_watched`
- `paced_read_completed`
- `walk_recall_completed`
- `graph_updated`
- `proposal_submitted`
- `content_reviewed`

Production deployments should attach trace IDs, user privacy scope, object IDs, model versions, and policy versions.

## Monitoring Contract

`GET /api/ops/monitoring` is the first-party operational alert surface. It combines queue/object health, dependency readiness, and security release gates into stable alert IDs, alert counts, service-level status, and a `ready_for_release` flag. Metrics exporters and pager adapters should consume this route instead of inventing separate queue, object-storage, or security semantics.
