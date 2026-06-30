# Security

Please report security issues privately before public disclosure.

Minimum expectations for production deployments:

- passkeys or OAuth login
- encrypted health tokens
- server-side API keys only
- role-based access control
- object-level authorization
- schema validation at every boundary
- audit logging for graph, admin, AI, privacy, and health-data events
- rate limiting and CSRF protection
- CSP headers
- separate consent for product analytics and research analytics
