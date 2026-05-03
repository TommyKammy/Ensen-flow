import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendWorkflowRunEvent,
  createAuditEvidenceExport,
  createLocalAuditEventWriter,
  createWorkflowRun
} from "../src/index.js";
import type { CreateNeutralAuditEventInput } from "../src/index.js";

const tempRoots: string[] = [];

const createTempAuditPath = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-audit-writer-"));
  tempRoots.push(root);
  return join(root, "audit", "manual-run.audit.jsonl");
};

const readAuditEvent = async (auditPath: string): Promise<Record<string, unknown>> => {
  const [line] = (await readFile(auditPath, "utf8")).trimEnd().split("\n");
  return JSON.parse(line) as Record<string, unknown>;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("neutral audit event writer", () => {
  it("exports public-safe audit and evidence metadata without raw local paths or trigger context", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    const auditRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot, auditRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");
    const auditPath = join(auditRoot, "audit", "manual-run.audit.jsonl");

    await createWorkflowRun(statePath, {
      runId: "local-manual-demo-export",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z",
        context: {
          requestId: "private-request-id",
          customerName: "private-customer"
        },
        idempotencyKey: {
          source: "input",
          key: "private-idempotency-key"
        }
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "local-manual-demo-export",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "local-manual-demo-export",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      result: {
        evidenceBundleRef: {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          id: "evb_manual_export",
          correlationId: "corr_manual_export",
          type: "local_path",
          uri: "artifacts/evidence/manual-export/bundle.json",
          createdAt: "2026-04-29T00:00:03.000Z"
        }
      }
    });
    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "local-manual-demo-export",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:04.000Z"
    });

    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "local-manual-demo", version: "flow.workflow.v1" },
      run: { id: "local-manual-demo-export" }
    });
    await writer.write({
      type: "workflow.completed",
      occurredAt: "2026-04-29T00:00:04.000Z",
      outcome: { status: "succeeded" }
    });

    const exported = await createAuditEvidenceExport({ statePath, auditPath });
    const serialized = JSON.stringify(exported);

    expect(exported).toMatchObject({
      schemaVersion: "flow.audit-evidence-export.v1",
      boundary: {
        productionEvidenceReady: false,
        protocolEvidenceProfile: "pending-protocol-phase-4"
      },
      publicSafe: {
        run: {
          runId: "local-manual-demo-export",
          workflowId: "local-manual-demo",
          status: "succeeded",
          terminalState: "succeeded"
        },
        trigger: {
          type: "manual",
          contextExported: false,
          idempotencyKey: {
            source: "input",
            keyExported: false
          }
        },
        evidenceRefs: [
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_manual_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: "artifacts/evidence/manual-export/bundle.json"
          }
        ],
        auditEvents: [
          {
            id: "audit.local-manual-demo-export.000001",
            type: "workflow.completed"
          }
        ]
      },
      localConfidentialReferences: {
        statePath: {
          classification: "local-confidential-reference",
          value: "<local-workflow-run-state-jsonl>"
        },
        auditPath: {
          classification: "local-confidential-reference",
          value: "<local-audit-jsonl>"
        }
      }
    });
    expect(serialized).not.toContain(statePath);
    expect(serialized).not.toContain(auditPath);
    expect(serialized).not.toContain("private-customer");
    expect(serialized).not.toContain("private-request-id");
    expect(serialized).not.toContain("private-idempotency-key");
  });

  it("freezes constructor context snapshots before later caller mutation", async () => {
    const auditPath = await createTempAuditPath();
    const workflow = { id: "trusted-workflow", version: "flow.workflow.v1" };
    const run = { id: "trusted-run" };
    const actor = { type: "system" as const, id: "trusted-actor" };
    const source = { type: "runner" as const, id: "trusted-source" };
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow,
      run,
      actor,
      source
    });

    workflow.id = "mutated-workflow";
    workflow.version = "flow.workflow.mutated";
    run.id = "mutated-run";
    actor.id = "mutated-actor";
    source.id = "mutated-source";

    await writer.write({
      type: "workflow.started",
      occurredAt: "2026-04-29T00:00:00.000Z"
    });

    await expect(readAuditEvent(auditPath)).resolves.toMatchObject({
      id: "audit.trusted-run.000001",
      actor: { type: "system", id: "trusted-actor" },
      source: { type: "runner", id: "trusted-source" },
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });
  });

  it("does not let runtime event input override trusted audit fields", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" },
      actor: { type: "system", id: "trusted-actor" },
      source: { type: "runner", id: "trusted-source" }
    });
    const untrustedPayload = {
      id: "attacker-id",
      type: "workflow.started",
      occurredAt: "2026-04-29T00:00:00.000Z",
      actor: { type: "system", id: "attacker-actor" },
      source: { type: "runner", id: "attacker-source" },
      workflow: { id: "attacker-workflow", version: "flow.workflow.v0" },
      run: { id: "attacker-run" }
    } as unknown as CreateNeutralAuditEventInput;

    await writer.write(untrustedPayload);

    await expect(readAuditEvent(auditPath)).resolves.toMatchObject({
      id: "audit.trusted-run.000001",
      type: "workflow.started",
      occurredAt: "2026-04-29T00:00:00.000Z",
      actor: { type: "system", id: "trusted-actor" },
      source: { type: "runner", id: "trusted-source" },
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });
  });

  it("rejects runtime event types outside the neutral audit union", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });

    await expect(
      writer.write({
        type: "workflow.deleted",
        occurredAt: "2026-04-29T00:00:00.000Z"
      } as unknown as CreateNeutralAuditEventInput)
    ).rejects.toThrow("audit event type is invalid");
  });

  it("rejects runtime actor and source types outside the neutral audit schema", async () => {
    const invalidActorWriter = createLocalAuditEventWriter({
      auditPath: await createTempAuditPath(),
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" },
      actor: { type: "operator", id: "trusted-actor" } as unknown as {
        type: "system";
        id: string;
      }
    });
    const invalidSourceWriter = createLocalAuditEventWriter({
      auditPath: await createTempAuditPath(),
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" },
      source: { type: "connector", id: "trusted-source" } as unknown as {
        type: "runner";
        id: string;
      }
    });

    await expect(
      invalidActorWriter.write({
        type: "workflow.started",
        occurredAt: "2026-04-29T00:00:00.000Z"
      })
    ).rejects.toThrow("audit event actor.type must be system");
    await expect(
      invalidSourceWriter.write({
        type: "workflow.started",
        occurredAt: "2026-04-29T00:00:00.000Z"
      })
    ).rejects.toThrow("audit event source.type must be runner");
  });

  it("rejects runtime outcome statuses outside the neutral audit schema", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });

    await expect(
      writer.write({
        type: "workflow.completed",
        occurredAt: "2026-04-29T00:00:00.000Z",
        outcome: { status: "complete" }
      } as unknown as CreateNeutralAuditEventInput)
    ).rejects.toThrow(
      "audit event outcome.status must be succeeded, failed, canceled, or retryable-failed"
    );
  });

  it("rejects non-UTC or locale timestamp strings", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });

    await expect(
      writer.write({
        type: "workflow.started",
        occurredAt: "04/29/2026"
      })
    ).rejects.toThrow("audit event occurredAt must be an ISO timestamp string");
    await expect(
      writer.write({
        type: "step.retry.scheduled",
        occurredAt: "2026-04-29T00:00:00+09:00",
        step: { id: "approval", attempt: 1 },
        retry: {
          retryable: true,
          reason: "temporary failure",
          nextAttemptAt: "2026-04-29T00:01:00+09:00"
        }
      })
    ).rejects.toThrow("audit event occurredAt must be an ISO timestamp string");
  });

  it("rejects invalid calendar days without relying on Date normalization", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "trusted-workflow", version: "flow.workflow.v1" },
      run: { id: "trusted-run" }
    });

    await expect(
      writer.write({
        type: "workflow.started",
        occurredAt: "2024-02-30T00:00:00.000Z"
      })
    ).rejects.toThrow("audit event occurredAt must be an ISO timestamp string");
    await expect(
      writer.write({
        type: "workflow.started",
        occurredAt: "0001-02-29T00:00:00.000Z"
      })
    ).rejects.toThrow("audit event occurredAt must be an ISO timestamp string");
  });
});
