# Operational Evidence Profile

The operational evidence profile is contract guidance for Loop and Flow X-Gate
3 Track A artifact hygiene checks before owner-controlled real input. It
describes how evidence and audit artifacts should label publishable examples,
local references, and producer facts without turning Ensen-protocol into a
runtime implementation.

This profile preserves the Ensen development charter: protocol over shared
implementation, bounded execution, evidence before authority, and no premature
compliance claims.

## Track A Boundary

Track A is owner-controlled repo / solo dogfood only. It is for synthetic and
owner-controlled protocol evidence while Loop and Flow harden artifact safety
checks.

Track A non-goals are customer repo input, ERPNext live connector input,
regulated data, electronic signature workflows, batch release workflows, final
disposition decisions, and any compliance guarantee.

Ensen-protocol defines this profile as contract text and public conformance
examples only. It is not a runtime implementation, not artifact storage, not
cleanup, not recovery, not a credential service, not a retention system, and
not a compliance guarantee. Loop and Flow remain responsible for their own
runtime behavior, artifact storage, cleanup, recovery, customer data handling,
and operational enforcement.

The short boundary rule is: not artifact storage, not cleanup, not recovery.

## Profile Fields

Use these terms when Loop or Flow records, exports, or tests operational
evidence references:

- `dataClassification`: required handling label for the evidence or audit
  surface. Public fixture-safe artifacts use `public`. Local real-input
  artifacts must use `internal`, `confidential`, or `restricted` as appropriate
  and must not be copied into this repository as fixtures.
- `checksum`: digest for the referenced evidence body when a stable body exists.
  EvidenceBundleRef v1 supports `sha256` with a lowercase hexadecimal value.
  Missing checksums are allowed only when the producing boundary explicitly
  records why no stable body is available.
- `producer metadata`: bounded public facts about the producer boundary, such as
  `producer`, `producerVersion`, `protocolVersion`, `command`, `boundary`, and
  `createdBy`. Producer metadata must not contain credentials, private repo
  details, customer identifiers, or workstation-local absolute paths.
- `retention hint`: advisory handling label such as `publicFixture`,
  `localEphemeral`, `localRetained`, or `externalControlled`. A retention hint
  is not a deletion guarantee, archive promise, legal hold, or final disposition
  decision.
- `confidential reference`: a local or external pointer to non-public evidence.
  Confidential references may be recorded in Loop or Flow local artifacts, but
  they are not public fixtures and must not be published as protocol examples.
- `public fixture-safe artifact`: synthetic, publishable JSON or Markdown that
  contains no raw secrets, tokens, customer data, private repository details,
  regulated data, workstation-local absolute paths, or live credential-bearing
  URIs.

## Public Fixtures And Local References

Loop and Flow should distinguish public fixture-safe artifacts from local
confidential reference values at the boundary where evidence is emitted or
copied:

| Surface | Expected use | Publishable in Ensen-protocol |
| --- | --- | --- |
| Public fixture-safe artifact | Synthetic conformance row for parser, audit, or EvidenceBundleRef hygiene tests | Yes |
| Local confidential reference | Owner-controlled real-input pointer retained in Loop or Flow local state | No |
| Redacted summary | Public statement that a private artifact exists without exposing the value | Yes, when synthetic |

Public examples should use repo-relative paths, neutral `file:///` examples, or
placeholders such as `<evidence-root>`, `<credential-ref>`,
`<repository-ref>`, and `<supervisor-config-path>`. They must not include raw
workstation-local paths, real repository private details, or values that look
like credentials.

Local confidential reference values should stay in the implementation
repository or evidence system that owns them. Protocol examples may describe
the shape of a confidential reference with placeholders, but must not publish
the real reference.

## Evidence And Audit Mapping

EvidenceBundleRef should carry the reference location, checksum when available,
content type, and bounded producer metadata. It should not embed evidence
bodies, test logs, screenshots, customer data, or secrets.

AuditEvent should record append-only facts about evidence production,
validation, rejection, or redaction. The audit payload may include
`dataClassification`, `retentionHint`, redacted `referenceKind`, producer
boundary, and checksum presence. It must not infer authorization, tenant,
repository, account, or environment linkage from path shape or operator-facing
summaries.

Consumers must fail closed when data classification, provenance, scope,
authorization context, or boundary signals are missing, malformed, or only
partially trusted. A syntactically valid EvidenceBundleRef or AuditEvent is not
proof that the referenced evidence is trusted or authorized.

## Conformance Example

The public conformance example lives at
`fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json`.
It is fixture-like guidance, not a new EIP schema family.

Loop and Flow may copy that example into local Track A artifact hygiene tests to
verify that:

- public examples remain `public` and synthetic;
- checksum values use the supported `sha256` form;
- producer metadata remains bounded and public;
- retention hint values are advisory only;
- confidential reference shape is represented with placeholders instead of real
  local values;
- public fixture-safe artifacts and local confidential references are not
  treated as interchangeable.
