# Event Replay

Mnemosyne keeps personal graph state derivable from first-party evidence. `@mnemosyne/replay-core` replays:

- persisted assessment responses and their `graph_updates`
- `video_watched` events with successful recall
- `paced_read_completed` events
- `sleep_cue_recall_completed` graph events

Replay resets touched concepts to a deterministic initial state by default, applies evidence in timestamp order, and preserves untouched concept states. This avoids double-counting old graph mutations while protecting concepts that have no replay evidence yet.

## API

`POST /api/graph/user/replay`

Body:

```json
{
  "userId": "user_demo",
  "dryRun": false,
  "resetTouchedConcepts": true
}
```

The handler loads the current personal graph, assessment responses, learning events, and master graph. Dry runs return the replayed graph without saving it. Non-dry runs persist the replayed state and audit `user_graph_replayed` with source counts, skipped events, and applied replay categories.

Replay is conservative. It does not invent graph changes from passive activity; video progress requires successful recall, and sleep replay only adjusts cued concepts recorded by the next-morning recall workflow.
