# EIP-0000 Common Types

EIP-0000 defines the shared schema conventions used by all v1 EIP artifacts.
The reusable JSON Schema definitions live in
`schemas/eip.common.v1.schema.json`.

## Identifier Conventions

An artifact id identifies the artifact itself. Each artifact schema has exactly
one artifact id field that names the primary artifact record.

reference IDs point at other protocol records. ActorRef, SourceRef,
WorkItemRef, ChangeRequestRef, and EvidenceBundleRef are references. They do
not redefine the referenced record and must not be treated as proof that the
referenced record exists or is authorized.

All common identifiers use `PrefixedId`: a registered 2-8 character lowercase
semantic prefix, an underscore, and an opaque suffix. The prefix states the
identifier family; the suffix is opaque and must not be parsed for tenant,
repository, account, issue, environment, or authorization facts. Public v1
artifact families use short prefixes such as `req_`, `run_`, `sts_`, `evt_`,
`evb_`, and `corr_`; long, hyphenated, or drifted prefixes such as
`runrequest_`, `runreq_`, and `executor-run_` are not canonical.

## Timestamp Conventions

v1 artifacts use explicit artifact field names for time values. Generic
`timestamp` fields are not used in v1 because they do not identify which
lifecycle event they describe.

Timestamps use `IsoDateTimeUtc`: ISO 8601 extended date-time strings with a
literal `Z` UTC offset. Local offsets are not accepted in common v1 fixtures.

## Event Identifier Conventions

Generic `eventId` fields are not used in v1 common conventions. Event-producing
artifacts must define an artifact-specific primary id instead of inheriting a
global event id alias.

## Primary ID Aliases

artifact-specific primary ID aliases are not used in v1. Schemas should choose
one primary artifact id field and use reference types for links to other
records.

## Common Reference Types

ActorRef identifies the actor associated with an artifact. It requires an
explicit actorId and actorType. Actor type values are limited to the Phase 1
actor categories: `human`, `workflow`, `system`, `api_client`, `connector`,
`executor`, and `agent`.

SourceRef identifies the source system or fixture family that produced the
artifact. It requires an explicit sourceId and sourceType.

WorkItemRef, ChangeRequestRef, and EvidenceBundleRef link to their respective
protocol records by explicit reference id fields.

## Data Classification

DataClassification labels the handling boundary for fixture and production
message data. v1 values are `public`, `internal`, `confidential`,
`customer-confidential`, `regulated`, and `restricted`.

Track B customer / regulated profile guidance lives in
`docs/integration/customer-regulated-data-classification-profile.md`. Customer
/ regulated references and evidence artifacts require an explicit
classification value before handling. Missing or unknown classification must
fail closed instead of being inferred from path shape, repository naming,
operator notes, or nearby metadata.

ErrorInfo carries structured failure information. Error codes are stable,
uppercase protocol tokens. Messages are diagnostic text and are not stable
machine contracts.

ExtensionMap is reserved for extension data. Extension keys must start with
`x-` so extension fields cannot be confused with future core fields.
