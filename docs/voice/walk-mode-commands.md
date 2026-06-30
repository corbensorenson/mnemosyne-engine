# WalkMode Voice Commands

Mnemosyne keeps WalkMode command handling first-party. Speech recognition can provide a transcript, but command intent, wake-safety, transcript deletion, and audit summaries are deterministic local product logic owned by `@mnemosyne/voice-core`.

## Contract

`parseWalkModeVoiceCommand` maps short transcripts to canonical WalkMode intents:

- listen
- repeat prompt
- score answer
- next prompt
- request hint
- skip prompt
- mark confusing
- delete transcript
- screen off
- end session

Unknown commands and commands that are unsafe for the current phase fail closed with safety flags such as `unrecognized_command`, `phase_blocked`, or `missing_active_prompt`.

## PWA Flow

The WalkMode surface accepts a command transcript, parses it locally, records a command log entry, and shows wake-safe, blocked, and unknown command counts. Transcript deletion commands can clear local answer text without sending raw command transcripts to the backend.

## API Flow

`POST /api/walk-mode/complete` accepts legacy `commandLog` strings plus compact `commandIntents` audit entries. The API summarizes total, wake-safe, blocked, and unknown commands in the completion event and audit payload. If structured intents are missing, the API parses the legacy log through the same first-party parser.

The backend stores compact command intent evidence, not raw voice-command transcripts, so voice privacy remains aligned with WalkMode transcript retention controls.
