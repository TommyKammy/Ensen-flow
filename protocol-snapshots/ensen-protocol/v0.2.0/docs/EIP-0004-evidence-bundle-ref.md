# EIP-0004 EvidenceBundleRef v1

EvidenceBundleRef v1 defines a transport-neutral reference to durable evidence
material. The machine-readable schema lives in
`schemas/eip.evidence-bundle-ref.v1.schema.json`.

EvidenceBundleRef is a reference artifact, not the evidence bundle body. It must
not embed logs, test output, screenshots, credentials, customer data, or other
evidence payloads. Producers store the body in an evidence system or filesystem
location and emit only the stable reference.

## Required Fields

- `schemaVersion`: must be `eip.evidence-bundle-ref.v1`.
- `id`: the EvidenceBundleRef artifact id.
- `correlationId`: shared tracing and retry correlation id.
- `type`: the reference kind. v1 supports `local_path` and `file_uri`.
- `uri`: the location of the evidence material using the syntax required by
  `type`.
- `createdAt`: UTC creation time for the reference artifact.

## Reference Types

`local_path` is for relative paths inside an agreed workspace, artifact root, or
evidence root. The path must not be a host-local absolute path, URI, or parent
directory traversal. Consumers resolve it only against the authoritative root
configured for the producer or exchange boundary.

`file_uri` is for explicit `file:///` URIs used when the exchange boundary has a
documented filesystem namespace. It must not contain credentials, query strings,
fragments, or parent directory traversal. Consumers must not infer tenant,
repository, account, or authorization scope from the path shape.

Other storage transports can be added in later schema versions after their
credential and authorization boundaries are specified.

## Optional Fields

- `contentType`: media type of the referenced evidence body.
- `checksum`: digest of the referenced body. v1 supports `sha256` with a
  lowercase 64-character hexadecimal value.
- `metadata`: small public descriptors about the reference.

Top-level fields outside the schema are rejected. Metadata is not an extension
point for evidence bodies or credentials.

## Security

EvidenceBundleRef must fail closed when provenance, scope, authorization
context, or boundary signals are missing or malformed. A syntactically valid
reference is not proof that the referenced material exists, is trusted, or is
authorized for the current consumer.

Reference URIs must not carry raw credentials or credential-shaped placeholders.
When a producer needs authenticated storage, the credential belongs in the
trusted storage boundary, not in the EvidenceBundleRef artifact.

## Fixture Safety

Checked-in EvidenceBundleRef fixtures must be synthetic and public. They should
use repo-relative local paths or neutral `file:///` examples, never workstation
home-directory paths, access tokens, passwords, private customer values, or
evidence bundle bodies.
