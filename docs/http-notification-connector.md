# HTTP Notification Connector Skeleton

The HTTP notification connector is a local skeleton for workflow steps whose
neutral action is `notification`. It lets tests describe an outbound HTTP-style
notification without enabling a real network call, credential lookup, webhook
provider, SaaS adapter, or Ensen-loop special case.

## Capability Boundary

The connector identity is `flow.http-notification.v1`. The connector declares a
notification capability through `capabilities.notify` and mirrors that support
onto the generic connector `submit` operation. In this skeleton, `status`,
`cancel`, and `fetchEvidence` are explicitly unsupported by default and return
fail-closed `unsupported-operation` results.

`submit` accepts a local endpoint alias, method, payload, attempt number, and
idempotency key. Endpoint aliases are stable placeholder names such as
`local-operator-notification`; they are not URLs and must not contain raw
hosts, customer endpoints, tokens, passwords, cookies, authorization headers, or
API keys.

## Fake Transport

`createFakeHttpNotificationTransport` is the only transport included here. It
records local deliveries in memory and returns scripted local outcomes:

- success
- terminal failure
- retryable failure
- unsupported notification capability

Repeated successful submissions with the same idempotency key replay the stored
receipt instead of recording another fake delivery. Retry tests can still
exercise multiple attempts by keeping the idempotency key explicit in each
delivery and using the runner retry state as the authoritative attempt record.

## Non-Goals

This issue does not enable outbound HTTP, public webhook listeners, signature
validation, OAuth, secret injection, provider-specific Slack or Teams behavior,
ERPNext behavior, Ensen-loop executor integration, Pharma/GxP workflow packs, or
any compliance claim.

Use focused local verification:

```sh
npm test -- test/http-notification-connector.test.ts
```
