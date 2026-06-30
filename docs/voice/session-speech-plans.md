# Session Speech Plans

Mnemosyne keeps low-screen session speech first-party. `@mnemosyne/audio-core` builds deterministic speech plans for prompt playback, feedback, and SleepCue preview. Browser speech synthesis is only a local execution surface; product policy, privacy scope, utterance ordering, and quiet fallback text stay in the repo.

## Covered Surfaces

- Morning Forge: retrieval instructions, prompt playback, and scored feedback.
- Tutor: mode framing, prompt playback, and gate-safe feedback.
- WalkMode: phase-aware prompt playback, repeat, and feedback.
- Evening Lock-In: audio-first recall, phone-down status, cue count, and feedback.
- SleepCue preview: sparse cue cadence and a few low-volume cue labels.

## Privacy Rules

Speech plans do not include raw learner answers or transcript audio. Plans carry explicit flags:

- `network_required: false`
- `raw_user_answer_included: false`
- `transcript_audio_included: false`

Every plan also includes `quiet_fallback` text so the PWA remains usable when speech synthesis is unavailable or inappropriate for the environment.

## PWA Behavior

The PWA applies the active speech plan only for the visible learning surface. The play control sends speakable utterances to `window.speechSynthesis` when available and otherwise reports that quiet fallback is ready. Stop cancels local speech immediately. Future generated-audio or native companion adapters should consume the same `SessionSpeechPlan` contract rather than bypassing these privacy rules.
