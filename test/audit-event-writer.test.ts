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
});
