# Data Export and Deletion

Mnemosyne treats personal graph data, voice artifacts, sleep data, health data, and wearable tokens as private by default. Export and deletion are product capabilities, API capabilities, and operational requirements.

## API Surface

### Export

`GET /api/privacy/export`

Validated handler: `exportUserData({ userId })`

The export bundle includes:

- user profile and preferences
- goals
- readiness profile
- personal graph state
- daily packets
- sleep cue packets
- linked audio plans
- assessment responses
- learning events
- user audit events
- session records
- installed packs
- experiment assignments and personalization profile
- social challenge participation and badges
- wearable connection records and normalized sleep sessions

Export schema version: `mnemosyne-export-v0.1`

Wearable tokens are never exported as plaintext. If a token exists, the export can contain only the encrypted token envelope.

### Delete

`DELETE /api/privacy/data`

Validated handler: `deleteUserData({ userId, scope, confirmation: "DELETE" })`

Supported scopes:

- `voice`: scrubs transcript and raw voice/audio payload fields from learning events.
- `health`: removes wearable connections and normalized wearable sleep sessions.
- `sleep`: removes sleep cue packets, linked sleep audio plans, sleep learning events, and wearable sleep sessions.
- `account`: removes the user account and user-owned records, removes pack installations, removes or updates social challenge participation, scrubs voice payloads, removes health/sleep data, and anonymizes retained audit events.

Every deletion returns a count summary and retained deletion audit event id.

## Audit Rules

- Export emits `user_data_exported`.
- Deletion emits `user_data_deleted`.
- Full account deletion anonymizes prior user audit events before writing the retained deletion audit event.
- Deletion audit payloads include counts, not deleted private content.

## Product Requirements

- Export must be available without asking the user to contact support.
- Destructive deletion must require explicit confirmation.
- Health and wearable deletion must clear local token envelopes and normalized sleep imports.
- Voice deletion must not erase scored learning outcomes unless the user requests full account deletion.
- Account deletion must leave no direct user id in retained audit actor ids.

## Test Coverage

The persistence-backed API suite verifies export bundle contents, absence of plaintext wearable tokens, voice payload redaction, health-data deletion, account deletion, and anonymized retained audit state.
