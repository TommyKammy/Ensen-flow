import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateWorkflowDefinition } from "../src/index.js";

const fixturePath = (...parts: string[]) =>
  join(process.cwd(), "fixtures", "workflow-definitions", ...parts);

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(fixturePath(name), "utf8")) as unknown;

describe("workflow definition schema", () => {
  it("accepts a simple local manual workflow fixture", () => {
    const result = validateWorkflowDefinition(readFixture("simple-manual.valid.json"));

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["missing workflow id", "missing-id.invalid.json", "workflow.id"],
    ["invalid dependency", "invalid-dependency.invalid.json", "steps[1].dependsOn[0]"],
    ["unsupported trigger shape", "unsupported-trigger.invalid.json", "trigger.type"],
    ["malformed retry policy", "malformed-retry-policy.invalid.json", "steps[0].retry.maxAttempts"],
    [
      "malformed idempotency semantics",
      "malformed-idempotency.invalid.json",
      "steps[0].idempotencyKey"
    ]
  ])("rejects %s", (_name, fixture, path) => {
    const result = validateWorkflowDefinition(readFixture(fixture));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path })])
    );
  });
});
