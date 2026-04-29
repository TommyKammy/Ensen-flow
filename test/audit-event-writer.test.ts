import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAuditEventWriter } from "../src/index.js";
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
});
