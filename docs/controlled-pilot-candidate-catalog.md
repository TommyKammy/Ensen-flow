# Controlled Pilot Candidate Catalog

This catalog defines the bounded Phase 6 candidate set for selecting the first
Ensen-flow controlled workflow pilot. It is a planning and review artifact for
FLOW-060 and the Flow Phase 6 roadmap. It is not a production runbook, customer
workflow approval, live ERPNext integration plan, regulated execution claim, or
compliance readiness claim.

The pilot scope stays inside Ensen-flow's standalone workflow engine boundary:
trigger intake, human approval, connector invocation, neutral audit/evidence
records, and recovery choices. It must stay owner-controlled, dry-run first,
and human-approval-gated before any externally visible action is attempted.

## Candidate Comparison

| Candidate family | Input classification | Connector capability | Approval point | Audit/evidence output | Rollback story | Non-goals |
| --- | --- | --- | --- | --- | --- | --- |
| manual approval plus notification | synthetic owner-authored fixture: a local approval request with public-safe placeholder text and no customer, regulated, secret, or private repository payload | fake HTTP notification connector only; transport declares a fake or dry-run boundary before `notify` is accepted | required before notification submit; missing, rejected, revoked, or malformed approval blocks the connector step | JSONL workflow run state, neutral audit JSONL events, approval-required step fact, fake notification receipt, and public-safe audit/evidence export metadata | retry the fake notification with the same idempotency key, re-run from sanitized fixture input, abandon the run, or mark manual repair needed while retaining JSONL and audit history | no real notification provider, no customer workflow, no ERPNext behavior, no write-back, no electronic signature, no batch release, no final disposition, no production readiness, and no compliance claim |
| scheduled repository hygiene report | synthetic repository-health fixture and one caller-supplied UTC scheduled instant; no live repository scan, host checkout path, or customer repo content | local schedule trigger helper plus local file or fake notification connector in dry-run mode | required before any report is sent or stored outside the local fixture boundary | scheduled run ID, JSONL run state, neutral audit events, dry-run report metadata, and retry/idempotency facts | re-evaluate the same scheduled instant idempotently, retry a failed local connector step, abandon stale runs, or require manual repair for corrupt state | no scheduler daemon, no repository mutation, no customer repository inspection, no pull request creation, no production monitoring, and no Loop dispatch |
| webhook intake to human review to HTTP notification | synthetic `flow.webhook.input.v1` local fixture with placeholder request fields; raw forwarded headers, tenant hints, user identity hints, and credential-shaped values are rejected | local webhook intake helper plus fake HTTP notification connector in dry-run mode | required after intake and before notification; intake alone never proves authorization, provenance, tenant, user, or approval context | accepted webhook fixture facts, approval-required review step, fake notification receipt, JSONL state, neutral audit events, and public-safe export metadata | replay the same `requestId` idempotently, retry fake notification failures, abandon unsafe requests, or require manual repair for contradictory JSONL state | no public HTTP listener, no production signature verification, no trusted proxy normalization, no customer webhook, no real notification delivery, no write-back, and no compliance claim |
| Ensen-loop dry-run dispatch | synthetic owner-controlled dispatch request with public-safe placeholders and explicit dry-run mode; no Loop authority is inferred from branch names, issue text, paths, or nearby metadata | executor connector interface only against fake or dry-run transport; no Ensen-loop implementation import and no external worker dependency | required before dispatch submit; missing policy decision, malformed scope, or ambiguous provenance blocks instead of allowing dispatch | Flow JSONL state, neutral audit events, dry-run executor receipt, connector flow-control state, and public-safe evidence reference metadata when available | retry only when the fake transport marks failure retryable and idempotency scope matches; otherwise re-run, abandon, or require manual repair without deleting evidence | no production Ensen-loop dispatch, no external executor service, no SCM mutation, no customer workflow, no ERPNext behavior, and no claim that Flow is a Loop wrapper |

## Selected First Pilot

The first controlled pilot is **webhook intake to human review to HTTP
notification**.

This candidate gives the smallest complete demonstration of Flow core workflow
value without depending on customer systems or Ensen-loop runtime behavior:

- trigger: a bounded local webhook fixture enters through `consumeWebhookInput`;
- approval: a human review step must record an explicit approval before the
  notification connector is called;
- connector: `flow.http-notification.v1` uses a fake or dry-run transport only;
- audit: JSONL run state, neutral audit events, approval facts, notification
  receipts, and public-safe audit/evidence export metadata are retained;
- recovery: webhook replay, retryable fake notification failure, abandon, and
  manual repair paths are covered by the controlled pilot recovery boundary.

The selected pilot is owner-controlled because the fixture, workflow definition,
review decision, fake transport, and local artifact paths are created by the
operator for the pilot attempt. It uses synthetic or sanitized input only. It is
dry-run first because the notification connector must declare a fake, local, or
dry-run input boundary, and missing or real-only connector boundary evidence is
blocked. It is human-approval-gated because intake and connector setup never
stand in for review approval.

## Future Candidates

The remaining candidate families stay as future work:

- manual approval plus notification can follow if the first pilot needs a
  smaller approval-only fixture;
- scheduled repository hygiene report can follow after the scheduler boundary
  and repository-content fixture boundary are explicitly accepted;
- Ensen-loop dry-run dispatch can follow after Flow proves the pilot value
  without becoming a Loop wrapper.

Future selection must update this catalog or a successor roadmap-linked artifact
before implementation begins.

## Excluded Scope

The candidate set explicitly excludes customer workflows, ERPNext live connector behavior,
regulated data, write-back, electronic signature, batch release, final
disposition, production readiness, and compliance claims.

Track B reached means the copied Protocol v0.4.0 vocabulary can inform bounded
classification and approval/draft-only evidence surfaces. It does not mean live ERPNext,
regulated execution, production operation, validated-system readiness, customer
approval, electronic-record readiness, final disposition approval, or compliance
approval.
It does not grant compliance approval.

## Review Checklist

- The pilot uses synthetic or sanitized input.
- The pilot remains owner-controlled and dry-run first.
- The pilot has a human approval gate before connector submit.
- Trigger, approval, connector, audit, and recovery behavior are all visible.
- Missing provenance, scope, authorization, connector boundary, or approval
  signals fail closed.
- No host-local absolute paths, raw secrets, customer data, regulated payloads,
  live ERPNext targets, or production provider credentials appear in pilot
  artifacts.
