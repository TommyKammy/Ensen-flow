import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  consumeWebhookInput,
  readWorkflowRunState,
  validateWorkflowDefinition
} from "../src/index.js";
import type { WorkflowDefinition, WebhookInput } from "../src/index.js";

const tempRoots: string[] = [];

const readFixture = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", ...parts), "utf8")) as T;

const createWebhookWorkflow = (): WorkflowDefinition =>
  readFixture("workflow-definitions", "simple-webhook.valid.json");

const createWebhookInput = (): WebhookInput =>
  readFixture("webhook-inputs", "local-demo.valid.json");

const createExpectedWebhookRunId = (workflowId: string, requestId: string): string => {
  const slug =
    requestId
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "request";
  const fingerprint = createHash("sha256").update(requestId).digest("hex").slice(0, 12);
  return `${workflowId}-webhook-${slug}-${fingerprint}`;
};

const createTempRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-webhook-"));
  tempRoots.push(root);
  return root;
};

const readAuditEvents = async (auditPath: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(auditPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("webhook intake boundary", () => {
  it("accepts the bounded local webhook trigger shape", () => {
    const result = validateWorkflowDefinition(createWebhookWorkflow());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("consumes a local webhook-shaped input into one idempotent workflow run", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "webhook.audit.jsonl");

    const first = await consumeWebhookInput({
      definition,
      stateRoot,
      auditPath,
      input: createWebhookInput(),
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-05-02T01:00:01.000Z",
          "2026-05-02T01:00:02.000Z",
          "2026-05-02T01:00:03.000Z",
          "2026-05-02T01:00:04.000Z"
        ];
        return () => timestamps[index++] ?? "2026-05-02T01:00:05.000Z";
      })()
    });
    const second = await consumeWebhookInput({
      definition,
      stateRoot,
      auditPath,
      input: createWebhookInput()
    });

    expect(second).toEqual(first);
    const expectedRunId = createExpectedWebhookRunId(definition.id, "webhook-001");
    expect(first.run.runId).toBe(expectedRunId);
    expect(first.run.trigger).toEqual({
      type: "webhook",
      receivedAt: "2026-05-02T01:00:01.000Z",
      context: {
        webhook: {
          inputFingerprint: expect.any(String),
          path: "/hooks/local-demo",
          receivedAt: "2026-05-02T01:00:00.000Z",
          headers: {
            "content-type": "application/json"
          },
          payload: {
            eventType: "local-demo.created",
            subject: "placeholder-subject"
          }
        },
        requestId: "webhook-001"
      },
      idempotencyKey: {
        source: "input",
        key: "webhook-001"
      }
    });

    const persisted = await readWorkflowRunState(
      join(stateRoot, `${expectedRunId}.jsonl`)
    );
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed",
      "run.completed"
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
    expect(auditEvents[0]).toMatchObject({
      id: `audit.${expectedRunId}.000001`,
      run: { id: expectedRunId }
    });
  });

  it("rejects reused requestIds when normalized webhook payload changes without writing audit events", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "webhook.audit.jsonl");
    const firstInput = createWebhookInput();
    const changedInput = createWebhookInput();
    changedInput.payload = {
      eventType: "local-demo.updated",
      subject: "placeholder-subject"
    };

    const first = await consumeWebhookInput({
      definition,
      stateRoot,
      auditPath,
      input: firstInput
    });
    const auditBeforeReplay = await readAuditEvents(auditPath);

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        auditPath,
        input: changedInput
      })
    ).rejects.toThrow("webhook requestId reuse must keep normalized input unchanged");

    const persisted = await readWorkflowRunState(join(stateRoot, `${first.run.runId}.jsonl`));
    expect(persisted).toEqual(first);
    expect(await readAuditEvents(auditPath)).toEqual(auditBeforeReplay);
  });

  it("rejects reused requestIds when normalized webhook headers or receivedAt change", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const firstInput = createWebhookInput();
    const changedHeaders = createWebhookInput();
    changedHeaders.headers = {
      "content-type": "application/json",
      "x-event-type": "local-demo.updated"
    };
    const changedReceivedAt = createWebhookInput();
    changedReceivedAt.receivedAt = "2026-05-02T01:00:01.000Z";

    await consumeWebhookInput({
      definition,
      stateRoot,
      input: firstInput
    });

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        input: changedHeaders
      })
    ).rejects.toThrow("webhook requestId reuse must keep normalized input unchanged");

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        input: changedReceivedAt
      })
    ).rejects.toThrow("webhook requestId reuse must keep normalized input unchanged");
  });

  it("keeps distinct requestIds with the same normalized slug in separate runs", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const firstInput = createWebhookInput();
    const secondInput = createWebhookInput();
    firstInput.requestId = "A.B";
    secondInput.requestId = "a-b";

    const first = await consumeWebhookInput({
      definition,
      stateRoot,
      input: firstInput
    });
    const second = await consumeWebhookInput({
      definition,
      stateRoot,
      input: secondInput
    });

    expect(first.run.runId).toBe(createExpectedWebhookRunId(definition.id, "A.B"));
    expect(second.run.runId).toBe(createExpectedWebhookRunId(definition.id, "a-b"));
    expect(first.run.runId).not.toBe(second.run.runId);
    expect(first.run.trigger.idempotencyKey).toEqual({ source: "input", key: "A.B" });
    expect(second.run.trigger.idempotencyKey).toEqual({ source: "input", key: "a-b" });
    await expect(readFile(join(stateRoot, `${first.run.runId}.jsonl`), "utf8")).resolves.toContain(
      first.run.runId
    );
    await expect(readFile(join(stateRoot, `${second.run.runId}.jsonl`), "utf8")).resolves.toContain(
      second.run.runId
    );
  });

  it("rejects malformed webhook payloads before writing partial run state", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "webhook.audit.jsonl");
    const malformed = createWebhookInput();
    malformed.path = "/hooks/other";
    const expectedRunId = createExpectedWebhookRunId(definition.id, malformed.requestId);

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        auditPath,
        input: malformed
      })
    ).rejects.toThrow("webhook input path must match workflow trigger.path");

    await expect(
      readFile(join(stateRoot, `${expectedRunId}.jsonl`), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects credential-shaped payload keys nested in arrays before writing state", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const input = createWebhookInput();
    input.payload = {
      eventType: "local-demo.created",
      items: [{ apiKey: "redacted" }]
    };
    const expectedRunId = createExpectedWebhookRunId(definition.id, input.requestId);

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        input
      })
    ).rejects.toThrow("webhook input payload.items[0].apiKey looks credential-shaped");

    await expect(readFile(join(stateRoot, `${expectedRunId}.jsonl`), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects untrusted forwarded or credential-shaped webhook headers fail-closed", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const input = createWebhookInput();
    input.headers = {
      authorization: "redacted",
      "x-forwarded-for": "203.0.113.10"
    };
    const expectedRunId = createExpectedWebhookRunId(definition.id, input.requestId);

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        input
      })
    ).rejects.toThrow("webhook headers must not include credential or forwarded boundary headers");

    await expect(
      readFile(join(stateRoot, `${expectedRunId}.jsonl`), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
