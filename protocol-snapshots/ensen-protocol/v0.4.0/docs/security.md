# Security

EIP artifacts are public contract material. They must not contain production
secrets, private credentials, or environment-specific tokens.

Security-sensitive protocol behavior should fail closed when provenance, scope,
authorization context, or boundary signals are missing or malformed. Examples,
schemas, and fixtures should use placeholders instead of fake credentials that
could be mistaken for valid secrets.

Treat implementation-specific identity headers, tenant hints, host values, and
forwarded request metadata as untrusted unless a documented trusted boundary has
authenticated and normalized them.
