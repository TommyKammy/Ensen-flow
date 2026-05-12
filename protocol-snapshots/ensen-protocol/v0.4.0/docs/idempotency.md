# Idempotency

EIP v1 uses CorrelationId to connect retries, related artifacts, and downstream
diagnostics without treating those records as the same artifact.

CorrelationId is not an authorization token, tenant binding, or primary
artifact id. Consumers must not infer scope or permission from a CorrelationId
value.

When a producer retries the same logical operation, it should reuse the same
CorrelationId and preserve the artifact-specific primary id rules for the
artifact being produced. Consumers that need idempotent behavior must combine
CorrelationId with the authoritative artifact type and scope record for that
contract.

If required provenance or scope bindings are missing, malformed, or only
partially trusted, consumers should fail closed instead of accepting a guessed
idempotency match.
