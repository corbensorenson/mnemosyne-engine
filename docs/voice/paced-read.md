# Paced Read

Paced Read is Mnemosyne's first-party rapid reading surface. It chunks graph-aligned text locally, reports effective WPM instead of raw speed, and only advances progress through comprehension and strain gates.

## Focus Modes

`@mnemosyne/paced-reader-core` owns the visual focus logic:

- `plain`: renders the current chunk as normal text
- `orp`: splits each token into lead, focus character, and tail using a deterministic optimal-recognition-point heuristic
- `highlight`: marks dense local terms from the current chunk without calling a hosted reading or keyword API

The PWA renders those focus frames in the Paced Read tab. Screen readers receive the intact chunk text rather than the split visual spans.

## Progress

Completion sync still posts measured evidence to `POST /api/paced-read/complete`; the backend scores effective WPM and graph progress from comprehension, retention, and strain evidence.
