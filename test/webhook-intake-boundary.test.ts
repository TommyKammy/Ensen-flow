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
    expect(first.run.runId).toBe("local-webhook-demo-webhook-webhook-001");
    expect(first.run.trigger).toEqual({
      type: "webhook",
      receivedAt: "2026-05-02T01:00:01.000Z",
      context: {
        webhook: {
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
      join(stateRoot, "local-webhook-demo-webhook-webhook-001.jsonl")
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
      id: "audit.local-webhook-demo-webhook-webhook-001.000001",
      run: { id: "local-webhook-demo-webhook-webhook-001" }
    });
  });

  it("rejects malformed webhook payloads before writing partial run state", async () => {
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "webhook.audit.jsonl");
    const malformed = createWebhookInput();
    malformed.path = "/hooks/other";

    await expect(
      consumeWebhookInput({
        definition: createWebhookWorkflow(),
        stateRoot,
        auditPath,
        input: malformed
      })
    ).rejects.toThrow("webhook input path must match workflow trigger.path");

    await expect(
      readFile(join(stateRoot, "local-webhook-demo-webhook-webhook-001.jsonl"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects untrusted forwarded or credential-shaped webhook headers fail-closed", async () => {
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const input = createWebhookInput();
    input.headers = {
      authorization: "redacted",
      "x-forwarded-for": "203.0.113.10"
    };

    await expect(
      consumeWebhookInput({
        definition: createWebhookWorkflow(),
        stateRoot,
        input
      })
    ).rejects.toThrow("webhook headers must not include credential or forwarded boundary headers");

    await expect(
      readFile(join(stateRoot, "local-webhook-demo-webhook-webhook-001.jsonl"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
