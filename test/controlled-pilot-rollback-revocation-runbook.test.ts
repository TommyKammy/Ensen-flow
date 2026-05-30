import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/controlled-pilot-rollback-revocation-runbook.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const linuxHomeRootPattern = new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("controlled pilot rollback and revocation runbook", () => {
  it("documents commands, artifacts, classifications, retained evidence, and X-Gate 5 blockers", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    for (const requiredText of [
      "Controlled Pilot Rollback and Revocation Runbook",
      "X-Gate 5",
      "partial failure",
      "approval rejection",
      "changed input",
      "blocked result",
      "transport unavailable",
      "revoked",
      "superseded",
      "retried",
      "retained evidence",
      "deleted local artifacts",
      "failure classification",
      "npm run build",
      "node dist/cli.js run fixtures/workflow-definitions/simple-manual.valid.json <state-jsonl-path> '{\"requestId\":\"pilot-rollback-dry-run\"}'",
      "node dist/cli.js export-audit-evidence <state-jsonl-path> [audit-jsonl-path] --output <export-json-path>",
      "CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>",
      "node dist/index.js issue-lint <this-issue-number>",
      "customer pilot approval remains out of scope",
      "regulated workflow execution approval remains out of scope",
      "ERPNext live write-back approval remains out of scope",
      "compliance claims remain out of scope",
      "production-ready claims remain out of scope"
    ]) {
      expect(runbook).toContain(requiredText);
    }

    expect(runbook).not.toMatch(posixHomeRootPattern);
    expect(runbook).not.toMatch(linuxHomeRootPattern);
    expect(runbook).not.toMatch(windowsHomeRootPattern);
  });

  it("links the runbook from public documentation navigation", async () => {
    const [readme, docsIndex] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8")
    ]);

    expect(readme).toContain("docs/controlled-pilot-rollback-revocation-runbook.md");
    expect(docsIndex).toContain("controlled-pilot-rollback-revocation-runbook.md");
  });
});
