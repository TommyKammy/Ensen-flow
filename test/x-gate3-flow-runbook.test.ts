import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/x-gate3-flow-caller-boundary-runbook.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const linuxHomeRootPattern = new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("X-Gate 3 Flow caller boundary runbook", () => {
  it("documents the process boundary, stdout contract, routing, and non-production limits", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    expect(runbook).toContain(
      "x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>",
    );
    expect(runbook).toContain("LOOP_ROOT=<codex-supervisor-root-or-loop-checkout>");
    expect(runbook).toContain("FLOW_SMOKE_ROOT=<temporary-flow-x-gate3-smoke-root>");
    expect(runbook).toContain("npm test -- test/x-gate3-flow-smoke.test.ts");
    expect(runbook).toContain("protocol-shaped input");
    expect(runbook).toContain("process stdout");
    expect(runbook).toContain("aggregate schema version");
    expect(runbook).toContain("boundary flags");
    expect(runbook).toContain("RunStatusSnapshot");
    expect(runbook).toContain("RunResult");
    expect(runbook).toContain("local artifact references");
    expect(runbook).toContain("protocol-gap");
    expect(runbook).toContain("loop-gap");
    expect(runbook).toContain("flow-gap");
    expect(runbook).toContain("TommyKammy/Ensen-protocol#28");
    expect(runbook).toContain("must not import Ensen-loop implementation code");
    expect(runbook).toContain("not production automation");
    expect(runbook).toContain("not compliance evidence");
    expect(runbook).toContain("no real provider");
    expect(runbook).toContain("no real repository");
    expect(runbook).toContain("no real pull request");
    expect(runbook).toContain("no ERPNext");
    expect(runbook).toContain("no Pharma/GxP");
    expect(runbook).toContain("Cleanup is limited to the temporary smoke root");
    expect(runbook).toContain("Do not delete repository checkouts, supervisor state");
    expect(runbook).not.toMatch(posixHomeRootPattern);
    expect(runbook).not.toMatch(linuxHomeRootPattern);
    expect(runbook).not.toMatch(windowsHomeRootPattern);
  });

  it("links the runbook from public documentation navigation", async () => {
    const [readme, docsIndex] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8"),
    ]);

    expect(readme).toContain("docs/x-gate3-flow-caller-boundary-runbook.md");
    expect(docsIndex).toContain("x-gate3-flow-caller-boundary-runbook.md");
  });
});
