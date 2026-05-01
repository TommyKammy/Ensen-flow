# Connector Capability Matrix

This matrix is the Phase 4 operator and implementer map for Ensen-flow trigger
and connector surfaces. It records what is supported in this repository today,
what is fake/local-only, what is unsupported, and what is intentionally deferred.

Ensen-flow remains standalone. These capabilities are not an Ensen-loop wrapper,
do not import implementation code from sibling repositories, and do not claim
production integration readiness.

## Status Labels

- supported: implemented in this repository for the stated local boundary.
- fake/local-only: available only through deterministic local helpers, fixtures,
  or fake transports.
- unsupported: the surface fails closed or has no runtime entrypoint here.
- deferred: intentionally left for a later connector, protocol, or product
  boundary after explicit design work.

## Matrix

| Surface | Current status | Retry | Idempotency | Approval-required | status | cancel | fetchEvidence | Unsupported and deferred behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| schedule trigger | fake/local-only: `evaluateScheduleTrigger` checks one supplied UTC instant and invokes the local runner when due. | Supported through workflow step retry policy after a scheduled run starts. The trigger helper itself does not retry scheduling. | Supported through a stable run ID and JSONL state path derived from workflow ID plus `scheduledFor`. | Unsupported at the trigger boundary; approvals belong to workflow steps or executor policy. | Unsupported as a trigger operation. Run state is read through JSONL helpers. | Unsupported; no background scheduler is started. | Unsupported; evidence is local run and audit state only. | Deferred: scheduler daemon, cron service integration, cloud scheduler, calendar integration, production time-zone policy, and cross-process lease management. |
| webhook intake | fake/local-only: `consumeWebhookInput` accepts a bounded `flow.webhook.input.v1` fixture for a declared local webhook path. | Supported through workflow step retry policy after intake accepts a request. Intake rejection is fail-closed and not retried by the helper. | Supported by deriving the run state path from `requestId`; repeated intake for the same request reads the existing terminal run instead of creating a duplicate. | Unsupported at intake; raw headers, forwarded boundary hints, tenant hints, user hints, and credential-shaped fields are rejected rather than treated as approval context. | Unsupported as an intake operation. Run state is read through JSONL helpers. | Unsupported; there is no public listener or queued webhook delivery to cancel. | Unsupported; accepted fixture data is recorded in local run state, not as an external evidence bundle. | Deferred: HTTP server, public endpoint, production signature verification, trusted proxy normalization, provider-specific webhook adapters, and durable queue intake. |
| HTTP notification connector | fake/local-only: `flow.http-notification.v1` uses `createFakeHttpNotificationTransport` for local notification outcomes. | Supported for fake transport failures when the outcome marks the error retryable and the workflow retry policy allows another attempt. | Supported for successful `submit` calls by replaying the stored receipt for the same idempotency key and unchanged request fingerprint. | Unsupported; the connector does not make policy decisions or prompt humans. | Unsupported and returns `unsupported-operation`. | Unsupported and returns `unsupported-operation`. | Unsupported and returns `unsupported-operation`; submit receipts carry sanitized local evidence only. | Deferred: outbound HTTP, URL targets, OAuth, secret injection, provider-specific Slack or Teams behavior, production delivery receipts, and network evidence retrieval. |
| local file connector | fake/local-only: `flow.local-file.v1` reads and writes UTF-8 fixture files under explicit allowed root aliases. | Supported for retryable local read failures such as missing fixture targets when the workflow retry policy allows another attempt. | Supported for successful `submit` calls through the connector idempotency store; changed replay fingerprints fail closed. | Unsupported; file access is bounded by allowed roots and does not request approvals. | Unsupported and returns `unsupported-operation`; actions complete inline. | Unsupported and returns `unsupported-operation`. | Unsupported and returns `unsupported-operation`; submit receipts include sanitized alias plus relative-path evidence only. | Deferred: unrestricted filesystem automation, binary blob processing, lane-state file access, repository mutation, production artifact storage, and customer data handling. |
| executor connector | supported interface boundary: `ExecutorConnector` defines submit, status, cancel, and fetchEvidence for future executor implementations, including explicit flow-control states. | Supported by interface results and runner retry handling when an implementation returns retryable connector failures. | Supported by carrying `idempotencyKey` through `ExecutorSubmitRequest`; each implementation must enforce durable replay semantics. | Supported as a flow-control state: `approval-required` is represented by `ExecutorPolicyDecisionPayload` and mapped by Flow before executor submission. | Supported by the interface contract. Local fake or future implementations must provide the actual snapshot behavior. | Supported by the interface contract. Local fake or future implementations must provide the actual cancellation behavior. | Supported by the interface contract. Local fake or future implementations must provide the actual evidence bundle behavior. | Deferred: production Ensen-loop dispatch, external executor service integration, remote auth, long-running transaction handling, and protocol contract changes in this repository. Missing policy decisions block instead of allowing execution. |

## Routing Later Connector Gaps

Keep later connector gaps narrow and routed to the owning boundary:

- protocol contract gaps: open or link Ensen-protocol work, such as
  `TommyKammy/Ensen-protocol#28`, when a missing or ambiguous EIP field blocks a
  clean Flow contract.
- Flow implementation gaps: keep the issue in Ensen-flow when the missing work
  is local orchestration, trigger intake, connector interface behavior, JSONL run
  state, or docs.
- Ensen-loop or executor gaps: route to the executor owner when the missing work
  requires dispatch, worker execution, remote status, cancellation, or evidence
  retrieval outside Flow.
- product adapter gaps: keep ERPNext, Pharma/GxP workflow packs, regulated
  workflows, e-signatures, customer-data connectors, and validation evidence out
  of this repository until a separate product boundary is explicitly accepted.

Do not close a gap by widening Ensen-flow into a black-box automation platform.
When provenance, scope, authorization context, identity, or connector boundary
signals are missing, reject the request, keep the guard in place, or open a
follow-up for the real prerequisite.

## Non-Claims

This document makes no production integration claim. It also makes no ERPNext,
no Pharma/GxP, and no compliance claim. The matrix documents current local and
interface behavior so operators can see the supported, fake/local-only,
unsupported, and deferred surfaces without inferring production readiness.
