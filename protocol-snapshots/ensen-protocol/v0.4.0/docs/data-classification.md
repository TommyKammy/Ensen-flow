# Data Classification

EIP artifacts carry a DataClassification value so producers and consumers can
apply appropriate handling rules.

## Classification Values

- `public`: safe for checked-in fixtures, examples, documentation, and public
  conformance tests.
- `internal`: intended for routine internal protocol operations, but not for
  public fixtures.
- `confidential`: contains business-sensitive or user-sensitive non-public
  production message data that is not specifically customer-owned or regulated.
- `customer-confidential`: contains customer-owned, customer-identifying, or
  customer-provided information that must stay in the owning customer /
  tenant evidence boundary.
- `regulated`: contains data or evidence subject to regulated handling,
  validation, retention, privacy, electronic record, or domain-specific control
  requirements.
- `restricted`: legacy high-sensitivity label for existing v1 artifacts that
  need stricter handling than `confidential`. New Track B customer / regulated
  evidence should use `customer-confidential` or `regulated` when those terms
  describe the boundary.

## Track B Customer / Regulated Profile

Track B customer / regulated profile is the short name for the required
classification profile used by customer / regulated evidence handoffs.

The Track B customer / regulated profile is the required classification profile
for protocol artifacts that reference customer-controlled systems, customer
evidence, regulated evidence, regulated workflow facts, or customer / regulated
AuditEvent and EvidenceBundleRef surfaces.

Classification required means the producer must emit one explicit
classification value before a customer / regulated reference or evidence
artifact can be handled as Track B evidence. The value must be selected from
the common `DataClassification` vocabulary above. The fail-closed trigger is
missing or unknown classification: consumers should reject, block, quarantine,
or route the artifact for an explicit protocol or consumer follow-up instead of
guessing that a nearby label is acceptable.

The detailed handoff profile is
`docs/integration/customer-regulated-data-classification-profile.md`.

## Fixture Data

public fixture data is synthetic, non-secret, and safe to publish in this
repository. Fixtures must not contain production identifiers, private customer
content, real credentials, access tokens, or host-local absolute paths.

Fixtures may resemble production message data structurally, but their values
must remain synthetic and must use `public` classification unless a test is
explicitly validating rejection of another value.

## Production Message Data

production message data may contain customer, tenant, account, repository,
workflow, or operational context. It must not be copied into this repository as
fixtures or examples.

Schemas define how production message data is shaped. They do not grant
permission to publish production message values.
