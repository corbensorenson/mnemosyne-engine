# Media Session Controls

Mnemosyne uses first-party media-session plans for lock-screen controls. The browser Media Session API is only a transport surface; action selection, privacy scope, and command routing are owned by `@mnemosyne/media-core`.

## Covered Surfaces

- WalkMode: play/listen, repeat, next prompt, screen-off pause, and end session.
- Paced Read: play, pause, previous chunk, next chunk, and restart.
- SleepCue: start playback, log playback/stop, and recall check.

## Privacy

Media metadata avoids raw answers, transcripts, private graph state, and health details:

- WalkMode exposes prompt-only context.
- Paced Read exposes learning content title and chunk position.
- SleepCue exposes cue spacing and density metadata, not concept IDs.

## PWA Behavior

The PWA applies a media-session plan only while WalkMode, Paced Read, or Sleep is the active surface. Unsupported browsers or unsupported actions fail open to normal in-app controls.

This keeps low-screen workflows usable without introducing a hosted playback or command-control dependency.
