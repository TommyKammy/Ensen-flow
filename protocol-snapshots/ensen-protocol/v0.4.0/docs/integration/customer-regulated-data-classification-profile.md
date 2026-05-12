# Track B Customer / Regulated Data Classification Profile

The Track B customer / regulated data classification profile defines the
shared protocol vocabulary that Loop, Flow, Pharma, and future consumers can
cite before customer or regulated evidence work begins.

This profile is contract text only. It preserves the Ensen development charter:
protocol over shared implementation, bounded execution, evidence before
authority, and no premature compliance claims. It does not add a runtime
validator package, connector, SDK, ERPNext integration, customer data access, or
compliance guarantee.

## Vocabulary

Use the common `DataClassification` values from
`schemas/eip.common.v1.schema.json`:

| Value | Boundary |
| --- | --- |
| `public` | Synthetic fixture, example, documentation, or conformance data that is safe to publish. |
| `internal` | Routine non-public protocol or operator evidence that is not customer-owned and not regulated. |
| `confidential` | Sensitive business or user production facts that are not specifically customer-owned or regulated. |
| `customer-confidential` | Customer-owned, customer-identifying, customer-provided, or customer-system-derived information. |
| `regulated` | Evidence or data subject to regulated handling, privacy, retention, validation, electronic record, or domain-specific controls. |

`restricted` remains a legacy high-sensitivity v1 label, but Track B customer /
regulated references should use `customer-confidential` or `regulated` when
those boundaries apply.

## When Classification Required

classification required is the Track B rule that a producer must emit an
explicit profile value before customer / regulated evidence handling begins.

Classification required applies before any Track B customer / regulated
reference or evidence artifact is accepted, copied, exported, or used as
handoff evidence.

Classification is required for:

- EvidenceBundleRef artifacts that point at customer evidence, regulated
  evidence, customer system output, or regulated workflow evidence;
- AuditEvent payloads that describe customer / regulated evidence production,
  validation, rejection, redaction, retention, or handoff;
- operational evidence profile records that cross from Track A synthetic or
  owner-controlled evidence into Track B customer / regulated handling;
- fixture-like examples that describe customer / regulated behavior, even when
  the checked-in values are synthetic and `public`;
- protocol snapshot records that name customer / regulated fixture families,
  profile documents, or consumer-side conformance evidence.

The fail-closed trigger is missing or unknown classification. Consumers should
reject, block, quarantine, or route an explicit follow-up when classification is
absent, not in the common vocabulary, inconsistent with the evidence boundary,
or only implied by names, paths, comments, issue text, operator summaries,
tenant hints, repository names, or nearby metadata.

In short: missing classification and unknown classification must fail closed.

## Artifact Mapping

EvidenceBundleRef should carry only a stable reference, checksum when
available, content type, and bounded public metadata. It must not embed
customer data, regulated data, private repository details, raw secrets, or
evidence bodies. For Track B, the reference handling boundary must have an
explicit classification before the reference is used.

A confidential reference is a reference to controlled material, not the
controlled material itself. It may describe that a non-public artifact exists
only through these bounded fields:

- stable id: a durable synthetic identifier for the reference record, not a
  customer identifier, tenant name, credential value, account id, repository
  path, or regulated record id;
- URI or locator: a placeholder or controlled-boundary locator such as
  `<controlled-evidence-root>/...`, never a raw workstation-local absolute
  path, live ERPNext URL, credential-bearing URI, private repository detail, or
  exposed customer system path;
- checksum: the digest algorithm and value for the controlled material when a
  stable body exists, or an explicit producer reason when no stable body can be
  digested;
- producer metadata: bounded facts such as producer name, producer boundary,
  protocol version, production time, and validation command, with no raw
  secrets, credentials, tokens, private repository details, or workstation-local
  paths;
- data classification: the explicit `customer-confidential` or `regulated`
  handling value for real controlled material, or `public` only when the value
  is a synthetic public fixture example.

Confidential references must be handled as not raw secret, not raw credential,
not raw customer record, and not raw regulated record payloads. When any of the
stable id, URI or locator, checksum expectation, producer metadata, or data
classification signals are missing, malformed, or only inferred from nearby
metadata, consumers should reject, quarantine, or route a follow-up instead of
accepting the reference.

AuditEvent should record append-only facts about classification, production,
validation, rejection, redaction, and handoff. AuditEvent payloads may include
`dataClassification`, redacted reference kind, producer boundary, checksum
presence, and follow-up routing. They must not infer customer, tenant,
repository, account, issue, environment, authorization, or regulated status from
path shape or operator-facing summaries.

The Track A `docs/integration/operational-evidence-profile.md` remains the
public fixture-safe artifact hygiene profile. Track B uses the same public
fixture safety rules, then adds required customer / regulated classification
before any customer / regulated references are handled.

The protocol snapshot policy in `docs/protocol-snapshot-policy.md` should name
this profile when a copied snapshot includes Track B customer / regulated
classification docs, fixtures, or downstream conformance evidence.

Approval-required, approved, rejected, revoked, superseded, and draft-only
action evidence should also follow
`docs/integration/approval-and-draft-evidence-semantics.md`. Classification is
still required for customer / regulated approval evidence, and approval state
must not be inferred from names, paths, comments, issue text, operator
summaries, or nearby metadata.

## Public Fixture Safety

Public examples for this profile must remain synthetic and publishable. They
must use `public` classification and must not contain customer data, regulated
data, raw secrets, credentials, access tokens, private repository details,
workstation-local absolute paths, live ERPNext write-back targets, electronic
signature records, batch release records, or final disposition records.

Use placeholders such as `<customer-ref>`, `<regulated-evidence-ref>`,
`<credential-ref>`, `<repository-ref>`, `<evidence-root>`, and
`<supervisor-config-path>` when a profile example needs to name a boundary
without exposing local or private state.

The public-safe conformance example lives at
`fixtures/customer-regulated-data-classification/v1/valid/public-safe-profile.json`.
It is fixture-like guidance, not a new EIP schema family.

## Track B Non-Claims

Track B reached means the protocol contract has enough vocabulary for downstream
customer / regulated evidence handling work to begin.

- not production-ready
- not a validated system
- not a compliance guarantee
- not automatic quality decision support
- not live ERPNext write-back
- not electronic signature
- not batch release
- not final disposition approval

Loop, Flow, Pharma, and future consumers remain responsible for runtime
authorization, customer boundary enforcement, regulated workflow controls,
credential handling, storage, retention, audit storage, validation evidence,
and any domain-specific compliance work.
