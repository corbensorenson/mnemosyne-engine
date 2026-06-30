# Authentication and Authorization

Mnemosyne uses a first-party authorization policy so private learning, voice, sleep, and health data do not depend on each route remembering to hand-roll access checks.

## Current Package

`@mnemosyne/auth-core` provides:

- session issuance for passkey, OAuth, or dev providers
- hashed session tokens
- hashed CSRF tokens
- optional device-binding hash
- session expiry checks
- object-level authorization decisions
- role-based access control
- consent-aware security posture

Roles:

- `learner`
- `creator`
- `moderator`
- `admin`
- `researcher`
- `service`

Sensitive resource kinds include:

- personal graph
- assessment response
- voice data
- sleep data
- health data
- privacy export
- privacy deletion
- admin operations

## API Surface

The API service exposes handler-level contracts that an HTTP layer can wrap:

- `POST /api/auth/session`
- `POST /api/auth/verify`
- `POST /api/auth/authorize`

Session issuance returns the session plus one-time-visible session and CSRF tokens. Stored session records contain only hashes.

Authorization decisions return:

- `allowed`
- `reason`
- `required_roles`
- `audit_action`
- current `SecurityPosture`

Every auth session issuance, token verification, and authorization check emits an audit event.

## Object-Level Rules

- Admin can access all surfaces.
- Service roles can operate internal jobs and sync/assign workflows.
- Learners can access their own profile, goals, graph, packets, sessions, assessments, voice, sleep, health, export, and deletion resources.
- Learners cannot read another user's private graph.
- Creators can manage their own creator submissions and create proposals.
- Moderators can review/release graph governance resources but cannot use admin-only operations.
- Researchers can read aggregate analytics, subject to consent.
- Public master graph and proposal reads are allowed to active sessions.

## Consent Rules

Product analytics and research analytics are separate consent gates. Research access must not be inferred from product analytics consent.

## Production HTTP Requirements

The eventual HTTP server must:

- bind route handlers to authenticated sessions
- verify session token and CSRF token before state-changing requests
- call object-level authorization before returning private data
- reject cross-user owner mismatches
- set secure, HTTP-only session cookies
- apply rate limits before expensive auth or AI paths
- audit failed authorization decisions without leaking private object payloads

See [`security-release-gates.md`](./security-release-gates.md) for the first-party CSP, rate-limit, high-stakes-domain, and audit-safety release gates that should wrap these handler contracts in production.

## Test Coverage

Current tests verify:

- token and CSRF hashes do not contain plaintext tokens
- token verification accepts correct tokens and rejects incorrect ones
- own private graph reads are allowed
- cross-user private graph reads are denied
- moderator proposal release is allowed
- learner admin operation is denied
- research analytics is denied without research consent
- API auth session issuance, verification, authorization decisions, and audit events
