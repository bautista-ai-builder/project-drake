# Google Cloud reference deployment

This is the Google-first reference, not a requirement of the core architecture.

## Services

- Cloud Run: Docker application
- Cloud SQL for PostgreSQL: canonical durable event log
- Vertex AI / Gemini live API: streaming transcription
- Cloud Translation Advanced: translation
- Secret Manager: database URL, ingest JWT secret and operations key
- Artifact Registry: container image

## Required APIs

Enable Cloud Run, Cloud Build or Artifact Registry, Secret Manager, Cloud SQL Admin, Vertex AI and Cloud Translation for the selected project. Use a dedicated runtime service account with only the roles required by those APIs and secret access.

## Deployment invariants

- Run migrations before shifting traffic.
- Set the request timeout high enough for WebSocket ingest and SSE clients.
- Use one Cloud Run application instance for the reference deployment. Distributed stage leases are not implemented yet.
- Do not expose `OPS_API_KEY`, `INGEST_JWT_SECRET` or `DATABASE_URL` as public build arguments.
- Configure `PUBLIC_BASE_URL`, project, location and exact provider model through environment variables.
- Health is available at `/api/health`; a database retry backlog changes it to `degraded` without killing live caption delivery.

## Portable replacements

| Google service | Portable replacement |
| --- | --- |
| Cloud Run | Docker Compose, systemd, Nomad, Kubernetes later |
| Cloud SQL | PostgreSQL 17 |
| Secret Manager | Docker secrets, SOPS, Vault |
| Gemini STT | `SttProvider` adapter such as faster-whisper |
| Cloud Translation | `TranslationProvider` adapter such as MADLAD or another API |
| Cloud Monitoring | OpenTelemetry collector + Prometheus/Grafana |

Never commit a rendered secret, credential file or service-account key. Prefer workload identity/Application Default Credentials.
