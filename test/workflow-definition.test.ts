import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateWorkflowDefinition } from "../src/index.js";
import type { WorkflowDefinitionValidationError } from "../src/index.js";

const fixturePath = (...parts: string[]) =>
  join(process.cwd(), "fixtures", "workflow-definitions", ...parts);

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(fixturePath(name), "utf8")) as unknown;

type MutableWorkflowFixture = {
  trigger: Record<string, unknown>;
  steps: Array<{
    action: Record<string, unknown>;
    retry?: Record<string, unknown> & { backoff?: Record<string, unknown> };
    idempotencyKey?: Record<string, unknown>;
  }>;
};

const readMutableWorkflowFixture = (): MutableWorkflowFixture =>
  readFixture("simple-manual.valid.json") as MutableWorkflowFixture;

describe("workflow definition schema", () => {
  it("accepts a simple local manual workflow fixture", () => {
    const result = validateWorkflowDefinition(readFixture("simple-manual.valid.json"));

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([
    [
      "missing workflow id",
      "missing-id.invalid.json",
      [
        {
          path: "workflow.id",
          message: "id must be a stable kebab-case identifier"
        }
      ]
    ],
    [
      "invalid dependency",
      "invalid-dependency.invalid.json",
      [
        {
          path: "steps[1].dependsOn[0]",
          message: "dependsOn entries must reference an existing step"
        }
      ]
    ],
    [
      "unsupported trigger shape",
      "unsupported-trigger.invalid.json",
      [
        {
          path: "trigger.queue",
          message: "queue is outside the workflow definition schema boundary"
        },
        {
          path: "trigger.type",
          message: "trigger.type must be manual, schedule, or webhook"
        }
      ]
    ],
    [
      "malformed retry policy",
      "malformed-retry-policy.invalid.json",
      [
        {
          path: "steps[0].retry.maxAttempts",
          message: "retry.maxAttempts must be a positive integer"
        }
      ]
    ],
    [
      "malformed idempotency semantics",
      "malformed-idempotency.invalid.json",
      [
        {
          path: "steps[0].idempotencyKey.template",
          message: "template must be a non-empty string"
        }
      ]
    ]
  ] satisfies Array<[string, string, WorkflowDefinitionValidationError[]]>)(
    "rejects %s",
    (_name, fixture, expectedErrors) => {
      const result = validateWorkflowDefinition(readFixture(fixture));

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expectedErrors);
    }
  );

  it.each([
    [
      "trigger",
      "trigger.extra",
      (workflow: MutableWorkflowFixture) => {
        workflow.trigger.extra = true;
      }
    ],
    [
      "action",
      "steps[0].action.extra",
      (workflow: MutableWorkflowFixture) => {
        workflow.steps[0].action.extra = true;
      }
    ],
    [
      "retry policy",
      "steps[0].retry.extra",
      (workflow: MutableWorkflowFixture) => {
        workflow.steps[0].retry!.extra = true;
      }
    ],
    [
      "retry backoff",
      "steps[0].retry.backoff.extra",
      (workflow: MutableWorkflowFixture) => {
        workflow.steps[0].retry!.backoff!.extra = true;
      }
    ],
    [
      "idempotency key",
      "steps[0].idempotencyKey.extra",
      (workflow: MutableWorkflowFixture) => {
        workflow.steps[0].idempotencyKey!.extra = true;
      }
    ]
  ] satisfies Array<[string, string, (workflow: MutableWorkflowFixture) => void]>)(
    "rejects unknown %s fields",
    (_name, path, mutate) => {
      const workflow = readMutableWorkflowFixture();
      mutate(workflow);

      const result = validateWorkflowDefinition(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          path,
          message: "extra is outside the workflow definition schema boundary"
        }
      ]);
    }
  );

  it("rejects fields from the wrong trigger variant", () => {
    const workflow = readMutableWorkflowFixture();
    workflow.trigger.path = "/manual-should-not-have-path";

    const result = validateWorkflowDefinition(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "trigger.path",
        message: "path is outside the workflow definition schema boundary"
      }
    ]);
  });
});
