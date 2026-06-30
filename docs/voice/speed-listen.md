# SpeedListen

SpeedListen is Mnemosyne's first-party time-compressed audio intake mode. It does not count raw fast playback as learning progress. A session only advances graph state when comprehension, retention, strain, and distraction gates pass.

## First-Party Contract

`@mnemosyne/audio-core` builds `mnemosyne-speed-listen-session-v0.1` plans from local transcript, recap, or note text. The planner:

- chunks source text into local speech utterances
- clamps playback rate by cognitive load
- estimates compressed listening time and effective WPM
- produces a local `SessionSpeechPlan`
- defines a comprehension gate and delayed retention check

The PWA executes the plan through browser speech synthesis when available. No hosted speech, compression, or playback scoring API is required.

## Progress Gate

`scoreSpeedListenCompletion` accepts:

- comprehension score
- retention score
- strain rating
- distraction rating
- raw listen WPM

Progress is held when comprehension or retention miss the gate, or when strain/distraction are too high. This keeps SpeedListen from becoming a reward for skimming audio without learning.

## PWA Surface

The Listen tab lets the learner choose a graph-aligned source, adjust playback rate, play/stop local speech, inspect chunks, and complete the gate. Passing sessions update local graph state; held sessions log failure modes without advancing mastery.

## Persistence

The PWA stages backend-compatible `speed_listen_completion` queue items to `POST /api/speed-listen/complete`. The API looks up the graph-owned video transcript or Paced Read recap source, rescoring comprehension, retention, strain, and distraction with `@mnemosyne/audio-core` before it updates concept state.

Successful sync records `speed_listen_completed`, writes an audit event, and feeds graph replay. The client does not send a trusted pass/fail flag; it sends the evidence needed for the first-party backend to recompute the gate.
