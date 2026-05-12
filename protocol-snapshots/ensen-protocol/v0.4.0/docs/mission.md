# Ensen-protocol Mission

This document is the Ensen-protocol repo-local short form of the Ensen
development charter.

## North Star

Ensen turns agentic and automated work into bounded, explainable, and auditable
execution.

Ensen-protocol defines the public contract that allows Ensen products and
external executors/connectors to cooperate without sharing runtime
implementation.

## Product Role

Ensen-protocol is the contract layer for the Ensen product family. It defines
the protocol text, JSON Schemas, fixtures, compatibility rules, and handoff
guidance that allow independently developed products to interoperate.

This repository is intentionally spec-only. It is strict, boring, and
fixture-tested. It is a contract, not a runtime.

## Charter Principles

- Protocol over shared implementation.
- Bounded execution over uncontrolled automation.
- Evidence before authority.
- Explainability over magic.
- Validation-ready over premature compliance claims.

## What This Repository Owns

- EIP contract text and compatibility guidance.
- Versioned JSON Schemas for public protocol messages.
- Public fixtures that consumers can validate and vendor.
- Data-classification, conformance, idempotency, and security guidance.
- Integration handoff notes for Ensen-loop, Ensen-flow, and future consumers.

## Boundaries

This repository must not contain runtime implementation code, including:

- workflow runtime implementation;
- loop engine implementation;
- connector implementation;
- ERPNext integration implementation;
- agent provider implementation;
- Pharma/GxP business process implementation.

Runtime behavior belongs in the relevant Ensen runtime repository. Protocol
changes should land here first as contract, schema, fixture, and compatibility
updates before downstream repositories implement the new behavior.

## Change Expectations

Before implementing a change, preserve the Ensen development charter: protocol
over shared implementation, bounded execution, evidence before authority, and
no premature compliance claims.

For meaningful protocol changes, include:

- the Ensen product goal the change supports;
- whether product boundaries are preserved;
- schema and fixture validation results;
- compatibility impact and migration notes when relevant;
- clear non-goals for runtime behavior that belongs outside this repository.

Use repo-relative verification commands in durable documentation:

```sh
npm install
npm test
```
