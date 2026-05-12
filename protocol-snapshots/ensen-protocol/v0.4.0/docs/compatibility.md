# Compatibility

Compatibility decisions are made at the protocol contract boundary.

- Producers and consumers should rely on documented schemas and fixtures rather
  than runtime-specific behavior.
- Optional fields must define default interpretation or explicit absence
  semantics before publication.
- Deprecated fields must remain documented until the supported compatibility
  window closes.
- Runtime repositories may implement the protocol differently, but observable
  behavior must remain compatible with the published EIP contract.
