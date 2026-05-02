import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/loop-flow-protocol-v0.2.0-connection-smoke.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const linuxHomeRootPattern = new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("Loop-Flow Protocol v0.2.0 connection smoke runbook", () => {
  it("documents the pre-Phase 5 snapshot boundary, commands, capability checks, and routing", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    for (const requiredText of [
      "pre-Phase 5",
      "protocol-snapshots/ensen-protocol/v0.2.0/",
      "RunRequest",
      "RunStatusSnapshot",
      "RunResult",
      "EvidenceBundleRef",
      "fixtures/capability-variants/v1/valid/",
      "npm run build",
      "npm test -- test/executor-connector.test.ts test/cli-loop-executor-smoke.test.ts test/protocol-snapshot.test.ts",
      "CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>",
      "<run-request-json-file>",
      "submit",
      "status",
      "cancel",
      "fetchEvidence",
      "polling support",
      "evidence reference support",
      "idempotency expectation",
      "unsupported operation",
      "must not fabricate terminal RunStatusSnapshot success",
      "must not mark the run cancelled by inference",
      "does not invent an EvidenceBundleRef",
      "protocol-gap",
      "loop-gap",
      "flow-gap",
      "TommyKammy/Ensen-protocol#28",
      "no production Loop dispatch",
      "not production Loop dispatch",
      "not production",
      "not compliance evidence",
      "Do not delete repository checkouts"
    ]) {
      expect(runbook).toContain(requiredText);
    }

    expect(runbook).not.toMatch(posixHomeRootPattern);
    expect(runbook).not.toMatch(linuxHomeRootPattern);
    expect(runbook).not.toMatch(windowsHomeRootPattern);
  });

  it("links the pre-Phase 5 smoke from public documentation navigation", async () => {
    const [readme, docsIndex] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8")
    ]);

    expect(readme).toContain("docs/loop-flow-protocol-v0.2.0-connection-smoke.md");
    expect(docsIndex).toContain("loop-flow-protocol-v0.2.0-connection-smoke.md");
  });
});
