# Track B Approval and Draft-Only Evidence Semantics

Track B approval and draft-only evidence semantics define shared protocol
vocabulary that Loop, Flow, Pharma, and future consumers can cite when an
artifact records a proposed action, a human approval point, or a later approval
state.

This profile is contract text only. It does not add a runtime approval engine,
workflow implementation, connector, ERPNext integration, electronic signature
service, batch release process, final disposition process, validated system, or
compliance guarantee.

## Approval Vocabulary

Use these values when approval state must be represented in Track B artifacts:

| Value | Meaning |
| --- | --- |
| `approval-required` | A human approval point is required before the action can be committed or externally applied. |
| `approved` | The required human approval point has been recorded by the authoritative workflow boundary. |
| `rejected` | The proposed action or evidence was declined and must not be treated as approved or applied. |
| `revoked` | A previously recorded approval was withdrawn by the authoritative workflow boundary. |
| `superseded` | A newer proposal, approval record, or evidence record replaces this one for future handling. |

These values describe evidence state. They do not make the protocol the final
quality decision maker. Consumers must resolve authority, actor eligibility,
tenant or repository scope, electronic record requirements, and final
disposition rules in their own runtime or validation package boundary.

## Draft-Only Action Artifacts

A draft-only action artifact records an intended action before it is committed
or externally applied. It is useful for read-only review, draft workflow
planning, and evidence handoff where the protocol needs to describe the
proposal without granting permission to mutate an external system.

A draft-only action artifact should make these facts explicit:

- the action intent is draft-only;
- the external application state is not-applied;
- the approval state is either `approval-required`, `rejected`, `revoked`, or
  `superseded` until the authoritative workflow boundary records `approved`;
- the artifact is not a committed artifact and not an externally applied
  artifact;
- any customer / regulated data classification follows
  `customer-regulated-data-classification-profile.md`.

A committed artifact is evidence that the producer boundary accepted the action
as part of its durable state. An externally applied artifact is evidence that a
consumer or connector boundary applied the action outside the protocol artifact
itself. The protocol can reference those facts, but it does not perform the
commit or external write-back.

## AuditEvent Usage

AuditEvent may record append-only facts about approval-required, approved,
rejected, revoked, or superseded evidence. Event types should name the owning
consumer namespace, for example `flow.approval.required` or
`pharma.approval.rejected`.

AuditEvent payloads should include bounded fields such as approval state,
draft-only intent, not-applied external state, approver or reviewer reference,
decision time, superseded reference id, rejection reason category, or revoked
approval reference. They must not contain raw secrets, credentials, customer
records, regulated record payloads, private repository details, live write-back
tokens, electronic signature material, batch release records, final disposition
records, or workstation-local absolute paths.

Rejected, revoked, and superseded states are new append-only facts. Consumers
should not edit older events to make them look as if they were never required
or never approved.

## EvidenceBundleRef Usage

EvidenceBundleRef may point to a bounded approval evidence body, draft-only
action artifact, rejection note, revocation record, or supersession record. The
reference remains a reference artifact only; it does not embed the evidence
body and does not prove the body is authorized for the current consumer.

EvidenceBundleRef metadata may include public descriptors such as
`approvalState`, `artifactIntent`, `externalApplicationState`,
`supersedesRef`, or `decisionBoundary` when those values are synthetic,
bounded, and safe for the exchange. Customer / regulated references require the
Track B classification profile before they are handled.

If provenance, approval authority, actor eligibility, scope binding,
classification, or evidence boundary signals are missing or malformed,
consumers should fail closed by rejecting, blocking, quarantining, or routing a
follow-up instead of inferring approval from nearby names, path shape, comments,
issue text, or operator-facing summaries.

## Public Fixture Safety

Public examples for this profile must remain synthetic and publishable. They
must not contain customer data, regulated data, raw secrets, credentials,
access tokens, private repository details, workstation-local absolute paths,
live ERPNext write-back targets, electronic signature records, batch release
records, final disposition records, or real external mutation evidence.

Use placeholders such as `<approval-boundary>`, `<reviewer-ref>`,
`<controlled-evidence-root>`, `<repository-ref>`, and
`<supervisor-config-path>` when an example needs to name a boundary without
exposing local or private state.

The public-safe conformance example lives at
`fixtures/approval-evidence-semantics/v1/valid/public-safe-draft-action.json`.
It is fixture-like guidance, not a new EIP schema family.

## Track B Non-Claims

This profile gives downstream consumers a shared vocabulary for approval
evidence. It is:

- not automatic quality decision support;
- not live write-back approval;
- not electronic signature;
- not batch release;
- not final disposition;
- not a validated system;
- not a compliance guarantee.

Loop, Flow, Pharma, and future consumers remain responsible for runtime
authorization, human review UX, electronic record controls, quality decisions,
customer boundary enforcement, regulated workflow controls, connector behavior,
storage, retention, and validation evidence.
