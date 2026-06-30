# Notification Scheduling

Mnemosyne treats learning reminders as first-party product state. The current implementation plans and records notifications without depending on a hosted push provider.

## Package

`@mnemosyne/notification-core`

The planner builds reminders from `User.notification_settings` and the current `DailyLearningPacket`:

- `morning_prompt`: Morning Forge recall prompt
- `evening_lock_in`: evening recall and cue-binding prompt
- `phone_down`: dusk quiet reminder before the sleep window
- `sleep_recall`: next-morning SleepCue recall check

Supported channels are `in_app`, `web_push_ready`, and `native_companion_recommended`. Non-`in_app` channels mean the outbox item is adapter-ready; they do not claim an OS push was sent.

## API Surface

`POST /api/notifications/schedule`

Validated handler: `scheduleNotifications({ userId, date?, generatedAt?, channel?, idempotencyPrefix?, maxAttempts? })`

The handler loads the user and optional daily packet, builds the notification plan, queues one `notification:deliver_learning_reminder` job per planned reminder, and audits `notifications_scheduled` with scheduled kinds, channels, and suppressed reasons.

## Worker

`@mnemosyne/worker-service` registers `notification:deliver_learning_reminder`.

The worker records a `notification_outbox_recorded` audit event containing:

- notification id, kind, channel, title, and scheduled time
- delivery status: `recorded` for in-app reminders or `adapter_ready` for future web/native push adapters
- packet and sleep/audio payload references

The job result mirrors the audit metadata so operators can inspect completed reminder work from queue state.

## Product Rules

- User notification settings suppress disabled prompt types.
- Phone-down and SleepCue recall prompts require a sleep packet.
- Notification workers must not fabricate delivery claims for browser or OS APIs.
- Future web-push or native-companion adapters should consume the outbox contract rather than bypassing it.

## Test Coverage

The unit suite verifies planner output and suppression, API job scheduling, deployment worker wiring, and worker outbox audit events.
