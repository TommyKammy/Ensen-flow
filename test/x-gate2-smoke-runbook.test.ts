import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/x-gate2-loop-flow-smoke-runbook.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("X-Gate 2 loop-flow smoke runbook", () => {
  it("documents the local smoke command, artifacts, routing, and boundaries", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    expect(runbook).toContain("node dist/cli.js run");
    expect(runbook).toContain("CODEX_SUPERVISOR_CONFIG");
    expect(runbook).toContain("artifacts/evidence/cli-loop-smoke/bundle.json");
    expect(runbook).toContain("protocol-gap");
    expect(runbook).toContain("loop-gap");
    expect(runbook).toContain("flow-gap");
    expect(runbook).toContain("TommyKammy/Ensen-protocol#27");
    expect(runbook).toContain("TommyKammy/Ensen-loop#35");
    expect(runbook).toContain("TommyKammy/Ensen-protocol#28");
    expect(runbook).toContain("no real repository mutation");
    expect(runbook).toContain("no real GitHub");
    expect(runbook).toContain("no real Codex");
    expect(runbook).toContain("no ERPNext");
    expect(runbook).toContain("no regulated workflow");
    expect(runbook).toContain("X-Gate 2 can be marked reached");
    expect(runbook).not.toMatch(posixHomeRootPattern);
    expect(runbook).not.toMatch(windowsHomeRootPattern);
  });
});
