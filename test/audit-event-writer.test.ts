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

const readAuditEvents = async (auditPath: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(auditPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>);

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("neutral audit event writer", () => {
  it("keeps audit event sequence IDs unique for concurrent writes on one writer", async () => {
    const auditPath = await createTempAuditPath();
    const writer = createLocalAuditEventWriter({
      auditPath,
      workflow: { id: "local-manual-demo", version: "flow.workflow.v1" },
      run: { id: "local-manual-demo-concurrent" }
    });

    const createEvent = (index: number): CreateNeutralAuditEventInput => ({
      type: "step.started",
      occurredAt: `2026-04-29T00:00:0${index}.000Z`,
      step: { id: "collect-input", attempt: index }
    });

    await Promise.all([writer.write(createEvent(1)), writer.write(createEvent(2))]);

    const events = await readAuditEvents(auditPath);
    expect(events.map((event) => event.id)).toEqual([
      "audit.local-manual-demo-concurrent.000001",
      "audit.local-manual-demo-concurrent.000002"
    ]);
  });

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
          privateLabel: "private-label"
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
          createdAt: "2026-04-29T00:00:03.000Z",
          dataClassification: "public"
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
          version: "0.4.0"
        },
        protocolEvidenceProfile: "operational-evidence-profile.v1"
      },
      publicSafe: {
        profile: {
          dataClassification: "public",
          producerMetadata: {
            producer: "ensen-flow",
            producerVersion: "flow.audit-evidence-export.v1",
            protocolVersion: "0.4.0",
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
    expect(serialized).not.toContain("private-label");
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

  it("filters audit summaries and replay IDs by run, workflow, and version", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    const auditRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot, auditRoot);
    const statePath = join(stateRoot, "runs", "scoped-audit-replay.jsonl");
    const auditPath = join(auditRoot, "audit", "scoped-audit-replay.audit.jsonl");

    await createWorkflowRun(statePath, {
      runId: "deterministic-run",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v2",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z",
        context: {}
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "deterministic-run",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "deterministic-run",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      result: { ok: true }
    });

    const scopedAuditEvent = (
      id: string,
      scope: { runId: string; workflowId: string; workflowVersion: string }
    ) => ({
      id,
      type: "step.completed",
      occurredAt: "2026-04-29T00:00:03.000Z",
      actor: { type: "system", id: "ensen-flow.local-runner" },
      source: { type: "runner", id: "ensen-flow.local-runner" },
      workflow: { id: scope.workflowId, version: scope.workflowVersion },
      run: { id: scope.runId },
      step: { id: "collect-input", attempt: 1 },
      outcome: { status: "succeeded" }
    });
    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(
      auditPath,
      [
        scopedAuditEvent("audit.deterministic-run.000001", {
          runId: "deterministic-run",
          workflowId: "local-manual-demo",
          workflowVersion: "flow.workflow.v2"
        }),
        scopedAuditEvent("audit.other-run.000001", {
          runId: "other-run",
          workflowId: "local-manual-demo",
          workflowVersion: "flow.workflow.v2"
        }),
        scopedAuditEvent("audit.deterministic-run.000002", {
          runId: "deterministic-run",
          workflowId: "other-workflow",
          workflowVersion: "flow.workflow.v2"
        }),
        scopedAuditEvent("audit.deterministic-run.000003", {
          runId: "deterministic-run",
          workflowId: "local-manual-demo",
          workflowVersion: "flow.workflow.v1"
        })
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
      "utf8"
    );

    const exported = await createAuditEvidenceExport({ statePath, auditPath });

    expect(exported.publicSafe.auditEvents.map((event) => event.id)).toEqual([
      "audit.deterministic-run.000001"
    ]);
    expect(exported.publicSafe.recoveryReplay.stepHistory).toEqual([
      expect.objectContaining({
        stepId: "collect-input",
        attempt: 1,
        auditEventIds: ["audit.deterministic-run.000001"]
      })
    ]);
  });

  it("treats manual-repair-needed step attempts as non-recoverable in replay export", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "manual-repair-needed.jsonl");

    await createWorkflowRun(statePath, {
      runId: "manual-repair-needed",
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
      runId: "manual-repair-needed",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.failed",
      runId: "manual-repair-needed",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      retry: {
        retryable: false,
        reason: "Operator must repair external state before replay."
      },
      recovery: {
        state: "manual-repair-needed",
        decision: "manual-repair-needed",
        reason: "Operator must repair external state before replay."
      }
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.recoveryReplay).toMatchObject({
      run: {
        status: "running",
        recoveryClassification: "manual-repair-needed",
        replayAction: "operator-review-required"
      },
      stepHistory: [
        expect.objectContaining({
          stepId: "collect-input",
          attempt: 1,
          status: "manual-repair-needed"
        })
      ]
    });
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
            createdAt: "2026-04-29T00:00:02.000Z",
            dataClassification: "public"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_windows_network_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: windowsNetworkPath,
            createdAt: "2026-04-29T00:00:02.000Z",
            dataClassification: "public"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_windows_network_file_uri_export",
            correlationId: "corr_manual_export",
            type: "file_uri",
            uri: "file://server/share/bundle.json",
            createdAt: "2026-04-29T00:00:02.000Z",
            dataClassification: "public"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_posix_host_file_uri_export",
            correlationId: "corr_manual_export",
            type: "file_uri",
            uri: posixHostFileUri,
            createdAt: "2026-04-29T00:00:02.000Z",
            dataClassification: "public"
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

  it("omits non-public evidence classifications instead of relabeling them as public-safe", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");

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
            id: "evb_internal_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: "artifacts/evidence/internal/bundle.json",
            createdAt: "2026-04-29T00:00:03.000Z",
            dataClassification: "internal"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_customer_confidential_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: "artifacts/evidence/customer-confidential/bundle.json",
            createdAt: "2026-04-29T00:00:03.000Z",
            dataClassification: "customer-confidential"
          },
          {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_regulated_export",
            correlationId: "corr_manual_export",
            type: "local_path",
            uri: "artifacts/evidence/regulated/bundle.json",
            createdAt: "2026-04-29T00:00:03.000Z",
            dataClassification: "regulated"
          }
        ]
      }
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.evidenceRefs).toEqual([]);
    expect(exported.publicSafe.diagnostics).toEqual([
      "omitted an evidence reference because its data classification is not public-safe",
      "omitted an evidence reference because its data classification is not public-safe",
      "omitted an evidence reference because its data classification is not public-safe"
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain("evb_internal_export");
    expect(JSON.stringify(exported.publicSafe)).not.toContain(
      "evb_customer_confidential_export"
    );
    expect(JSON.stringify(exported.publicSafe)).not.toContain("evb_regulated_export");
  });

  it("continues scanning envelope siblings and respects stricter nested classifications", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");

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
        evidence: {
          transport: {
            dataClassification: "public",
            evidenceBundleRef: {
              schemaVersion: "eip.evidence-bundle-ref.v1",
              id: "evb_enveloped_public_export",
              correlationId: "corr_manual_export",
              type: "local_path",
              uri: "artifacts/evidence/public/enveloped-bundle.json",
              createdAt: "2026-04-29T00:00:03.000Z"
            },
            additionalRefs: [
              {
                schemaVersion: "eip.evidence-bundle-ref.v1",
                id: "evb_envelope_sibling_export",
                correlationId: "corr_manual_export",
                type: "local_path",
                uri: "artifacts/evidence/public/sibling-bundle.json",
                createdAt: "2026-04-29T00:00:03.000Z",
                dataClassification: "public"
              }
            ]
          },
          stricterNestedRef: {
            dataClassification: "public",
            evidenceBundleRef: {
              schemaVersion: "eip.evidence-bundle-ref.v1",
              id: "evb_nested_internal_export",
              correlationId: "corr_manual_export",
              type: "local_path",
              uri: "artifacts/evidence/internal/nested-bundle.json",
              createdAt: "2026-04-29T00:00:03.000Z",
              dataClassification: "internal"
            }
          }
        }
      }
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.evidenceRefs.map((ref) => ref.id)).toEqual([
      "evb_enveloped_public_export",
      "evb_envelope_sibling_export"
    ]);
    expect(exported.publicSafe.diagnostics).toEqual([
      "omitted an evidence reference because its data classification is not public-safe"
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain("evb_nested_internal_export");
  });

  it("rejects unknown evidence data classifications before writing an export artifact", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    const exportRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot, exportRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");
    const outputPath = join(exportRoot, "exports", "audit-evidence.json");

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
        evidenceBundleRef: {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          id: "evb_unknown_classification_export",
          correlationId: "corr_manual_export",
          type: "local_path",
          uri: "artifacts/evidence/public/bundle.json",
          createdAt: "2026-04-29T00:00:03.000Z",
          dataClassification: "partner-private"
        }
      }
    });

    await expect(createAuditEvidenceExport({ statePath, outputPath })).rejects.toThrow(
      'evidence ref evb_unknown_classification_export has unsupported dataClassification "partner-private"'
    );
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });

  it("omits missing evidence data classifications from public-safe exports", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    const exportRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot, exportRoot);
    const statePath = join(stateRoot, "runs", "manual-run.jsonl");
    const outputPath = join(exportRoot, "exports", "audit-evidence.json");

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
        evidenceBundleRef: {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          id: "evb_missing_classification_export",
          correlationId: "corr_manual_export",
          type: "local_path",
          uri: "artifacts/evidence/public/bundle.json",
          createdAt: "2026-04-29T00:00:03.000Z"
        }
      }
    });

    const exported = await createAuditEvidenceExport({ statePath, outputPath });

    expect(exported.publicSafe.evidenceRefs).toEqual([]);
    expect(exported.publicSafe.diagnostics).toEqual([
      "omitted an evidence reference because its data classification is missing"
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain(
      "evb_missing_classification_export"
    );
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "omitted an evidence reference because its data classification is missing"
    );
  });

  it("does not export unknown approval checkpoint states from generic step results", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "unknown-approval-state.jsonl");

    await createWorkflowRun(statePath, {
      runId: "unknown-approval-state",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "unknown-approval-state",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "unknown-approval-state",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      result: {
        metadata: {
          approvalCheckpoint: {
            schemaVersion: "flow.approval-checkpoint.v1",
            state: "raw-customer-approval-note",
            inputRef: "fixtures/manual-review/input.json",
            decidedAt: "2026-04-29T00:00:03.000Z"
          }
        }
      }
    });
    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "unknown-approval-state",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:04.000Z"
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.recoveryReplay.stepHistory).toEqual([
      expect.not.objectContaining({
        approval: expect.anything()
      })
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain("raw-customer-approval-note");
  });

  it("does not export unclassified approval input refs from generic step results", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "unclassified-approval-input-ref.jsonl");

    await createWorkflowRun(statePath, {
      runId: "unclassified-approval-input-ref",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "unclassified-approval-input-ref",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "unclassified-approval-input-ref",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      result: {
        metadata: {
          approvalCheckpoint: {
            schemaVersion: "flow.approval-checkpoint.v1",
            state: "approved",
            inputRef: "approvals/acme-contract.json",
            decidedAt: "2026-04-29T00:00:03.000Z"
          }
        }
      }
    });
    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "unclassified-approval-input-ref",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:04.000Z"
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.recoveryReplay.stepHistory).toEqual([
      expect.objectContaining({
        approval: {
          state: "approved",
          decidedAt: "2026-04-29T00:00:03.000Z",
          reasonExported: false,
          decidedByExported: false
        }
      })
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain("approvals/acme-contract.json");
  });

  it("does not export malformed approval decision timestamps from generic step results", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ensen-flow-audit-export-"));
    tempRoots.push(stateRoot);
    const statePath = join(stateRoot, "runs", "malformed-approval-decided-at.jsonl");

    await createWorkflowRun(statePath, {
      runId: "malformed-approval-decided-at",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "malformed-approval-decided-at",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "malformed-approval-decided-at",
      stepId: "generic-step",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      result: {
        metadata: {
          approvalCheckpoint: {
            schemaVersion: "flow.approval-checkpoint.v1",
            state: "approved",
            inputRef: "fixtures/manual-review/input.json",
            inputRefDataClassification: "public",
            decidedAt: "not-a-timestamp"
          }
        }
      }
    });
    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "malformed-approval-decided-at",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:04.000Z"
    });

    const exported = await createAuditEvidenceExport({ statePath });

    expect(exported.publicSafe.recoveryReplay.stepHistory).toEqual([
      expect.objectContaining({
        approval: {
          state: "approved",
          inputRef: "fixtures/manual-review/input.json",
          reasonExported: false,
          decidedByExported: false
        }
      })
    ]);
    expect(JSON.stringify(exported.publicSafe)).not.toContain("not-a-timestamp");
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
