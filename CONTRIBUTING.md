# Contributing

Project Drake welcomes issues and pull requests for accessibility-focused conference infrastructure.

1. Create `.env` from `.env.example` and do not commit secrets.
2. Keep provider-specific payloads behind the provider interfaces.
3. Preserve the canonical audio clock and the rule that translation never blocks original captions.
4. Run `pnpm check` and `pnpm build` before opening a pull request.
5. Add tests for reconnect, ordering, idempotency or failure behavior when changing the realtime path.

Avoid adding Kubernetes, Kafka, microservices or agent orchestration unless a measured requirement justifies the operational cost.
