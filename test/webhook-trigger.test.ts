import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  consumeWebhookInput,
  readWorkflowRunState
} from "../src/index.js";
import type { WebhookInput, WorkflowDefinition } from "../src/index.js";

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
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-webhook-trigger-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("webhook trigger controlled pilot boundary", () => {
  it("keeps webhook intake fake/local and rejects changed requestId replays without extra state", async () => {
    const definition = createWebhookWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const firstInput = createWebhookInput();
    const changedInput = createWebhookInput();
    changedInput.payload = {
      eventType: "local-demo.updated",
      subject: "placeholder-subject"
    };

    const first = await consumeWebhookInput({
      definition,
      stateRoot,
      input: firstInput
    });
    const expectedRunId = createExpectedWebhookRunId(definition.id, firstInput.requestId);
    const beforeReplay = await readFile(join(stateRoot, `${expectedRunId}.jsonl`), "utf8");

    await expect(
      consumeWebhookInput({
        definition,
        stateRoot,
        input: changedInput
      })
    ).rejects.toThrow("webhook requestId reuse must keep normalized input unchanged");

    expect(first.run.runId).toBe(expectedRunId);
    expect(await readWorkflowRunState(join(stateRoot, `${expectedRunId}.jsonl`))).toEqual(first);
    await expect(readFile(join(stateRoot, `${expectedRunId}.jsonl`), "utf8")).resolves.toBe(
      beforeReplay
    );
  });
});
