# Security policy

Please report vulnerabilities privately to the maintainers rather than opening a public issue with secrets or exploit details.

## Operational model

- Audience, overlay and SSE read paths are intentionally public.
- Creating events, stages and talk configurations is public in the reference build. Operational mutations such as starting or stopping pipelines require `X-Ops-Key`.
- Audio ingest uses a short-lived, stage/talk-scoped JWT.
- Provider credentials use Application Default Credentials or runtime identity and must never be sent to the browser.
- PostgreSQL, provider APIs and the public app should use encrypted transport outside a local development machine.

The reference implementation is not a complete multi-tenant security boundary. Before a public production event, add rate limiting, explicit event ownership, audit logging, secret rotation and an external authorization layer for operations.
