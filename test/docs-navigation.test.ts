import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/controlled-pilot-rollback-recovery-runbook.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const linuxHomeRootPattern = new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("documentation navigation", () => {
  it("links the controlled pilot rollback and recovery runbook from public docs", async () => {
    const [readme, docsIndex] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8")
    ]);

    expect(readme).toContain("docs/controlled-pilot-rollback-recovery-runbook.md");
    expect(docsIndex).toContain("controlled-pilot-rollback-recovery-runbook.md");
  });

  it("documents controlled pilot recovery decisions without host-local paths", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    for (const requiredText of [
      "Controlled Pilot Rollback and Recovery Runbook",
      "X-Gate 3 Track A safety tracker.md",
      "Flow Phase 5",
      "retry, re-run, abandon, or manual repair",
      "inspectWorkflowRunRecovery(<state-jsonl-path>)",
      "stopWorkflowRunRecovery",
      "Decision Table",
      "recoverable",
      "approval-required",
      "manual-repair-needed",
      "blocked",
      "corrupt",
      "JSONL state recovery",
      "Approval recovery",
      "Retry and idempotency recovery",
      "Notification misfires",
      "Webhook replay handling",
      "Loop connector failures stay at the connector boundary",
      "workflow run JSONL files",
      "neutral audit JSONL files",
      "public-safe audit/evidence exports",
      "Do not automatically clean repository checkouts",
      "CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>",
      "node dist/index.js issue-lint <this-issue-number>"
    ]) {
      expect(runbook).toContain(requiredText);
    }

    expect(runbook).not.toMatch(posixHomeRootPattern);
    expect(runbook).not.toMatch(linuxHomeRootPattern);
    expect(runbook).not.toMatch(windowsHomeRootPattern);
  });
});
