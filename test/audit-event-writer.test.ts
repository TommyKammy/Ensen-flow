import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
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
        protocolSnapshot: {
          name: "ensen-protocol",
          version: "0.3.0"
        },
        protocolEvidenceProfile: "operational-evidence-profile.v1"
      },
      publicSafe: {
        profile: {
          dataClassification: "public",
          producerMetadata: {
            producer: "ensen-flow",
            producerVersion: "flow.audit-evidence-export.v1",
            protocolVersion: "0.3.0",
            command: "export-audit-evidence",
            boundary: "local-audit-evidence-export",
            createdBy: "ensen-flow"
          },
          retentionHint: "localEphemeral",
          confidentialReferencePolicy: {
            allowedInPublicSafe: false,
            localConfidentialReferenceValuesExported: false
          }
        },
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
            uri: "artifacts/evidence/manual-export/bundle.json",
            dataClassification: "public",
            referenceKind: "publicSafeArtifactReference",
            checksumPresence: "absent"
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

  it("rejects malformed optional audit event export fields before summarizing", async () => {
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
        context: {}
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(
      auditPath,
      `${JSON.stringify({
        id: "audit.local-manual-demo-export.000001",
        type: "step.completed",
        occurredAt: "2026-04-29T00:00:02.000Z",
        actor: { type: "system", id: "ensen-flow.local-runner" },
        source: { type: "runner", id: "ensen-flow.local-runner" },
        workflow: { id: "local-manual-demo", version: "flow.workflow.v1" },
        run: { id: "local-manual-demo-export" },
        step: null
      })}\n`,
      "utf8"
    );

    await expect(createAuditEvidenceExport({ statePath, auditPath })).rejects.toThrow(
      "audit event export failed: audit JSONL line 1: record is outside the audit export boundary"
    );

    await writeFile(
      auditPath,
      `${JSON.stringify({
        id: "audit.local-manual-demo-export.000001",
        type: "workflow.completed",
        occurredAt: "2026-04-29T00:00:02.000Z",
        actor: { type: "system", id: "ensen-flow.local-runner" },
        source: { type: "runner", id: "ensen-flow.local-runner" },
        workflow: { id: "local-manual-demo", version: "flow.workflow.v1" },
        run: { id: "local-manual-demo-export" },
        outcome: null
      })}\n`,
      "utf8"
    );

    await expect(createAuditEvidenceExport({ statePath, auditPath })).rejects.toThrow(
      "audit event export failed: audit JSONL line 1: record is outside the audit export boundary"
    );
  });

  it("omits non-public evidence paths from public-safe exports", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");
    const windowsNetworkPath = ["", "", "server", "share", "bundle.json"].join("\\");
    const posixHostFileUri = ["file://", "private", "tmp", "secret-bundle.json"].join("/");

    await createWorkflowRun(statePath, {
      runId: "local-manual-demo-export",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z",
        context: {}
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
        evidenceRefs: [
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_public_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: "artifacts/evidence/public/bundle.json",
            createdAt: "2026-04-29T00:00:02.000Z"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_windows_network_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: windowsNetworkPath,
            createdAt: "2026-04-29T00:00:02.000Z"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_windows_network_file_uri_export",
            correlationId: "corr_manual_export",
            type: "file_uri",
            uri: "file://server/share/bundle.json",
            createdAt: "2026-04-29T00:00:02.000Z"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_posix_host_file_uri_export",
            correlationId: "corr_manual_export",
            type: "file_uri",
            uri: posixHostFileUri,
            createdAt: "2026-04-29T00:00:02.000Z"
          }
        ]
      }
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.evidenceRefs.map((ref) => ref.uri)).toEqual([
      "artifacts/evidence/public/bundle.json"
    ]);
    expect(exported.publicSafe.diagnostics).toEqual([
      "omitted an evidence reference because its URI is not public-safe (category: non-public-uri)",
      "omitted an evidence reference because its URI is not public-safe (category: non-public-uri)",
      "omitted an evidence reference because its URI is not public-safe (category: non-public-uri)"
    ]);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(windowsNetworkPath);
    expect(serialized).not.toContain(posixHostFileUri);
  });

  it("rejects extra export-audit-evidence CLI arguments", async () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message?: unknown): void => {
      errors.push(String(message));
    };

    try {
      await expect(
        runCli([
          "export-audit-evidence",
          "state.jsonl",
          "audit.jsonl",
          "--output",
          "export.json",
          "extra"
        ])
      ).resolves.toBe(2);
    } finally {
      console.error = originalError;
    }

    expect(errors.join("\n")).toContain(
      "node dist/cli.js export-audit-evidence <state.jsonl> [audit.jsonl] [--output <export.json>]"
    );
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
      "audit event outcome.status must be succeeded, failed, canceled, retryable-failed, approval-required, blocked, or manual-repair-needed"
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
