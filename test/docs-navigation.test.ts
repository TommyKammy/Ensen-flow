import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const runbookPath = "docs/controlled-pilot-rollback-recovery-runbook.md";
const flowClosurePath = "docs/x-gate3-track-a-flow-closure.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const operationalEvidenceSnapshotReadmePath =
  "protocol-snapshots/ensen-protocol/v0.3.0/README.md";
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

  it("links the Protocol v0.3.0 operational evidence profile snapshot from public docs", async () => {
    const [readme, docsIndex, snapshotReadme] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8"),
      readFile(operationalEvidenceSnapshotReadmePath, "utf8")
    ]);

    expect(readme).toContain(
      "protocol-snapshots/ensen-protocol/v0.3.0/README.md"
    );
    expect(readme).toContain(
      "protocol-snapshots/ensen-protocol/v0.3.0/docs/integration/operational-evidence-profile.md"
    );
    expect(docsIndex).toContain(
      "../protocol-snapshots/ensen-protocol/v0.3.0/README.md"
    );
    expect(docsIndex).toContain(
      "../protocol-snapshots/ensen-protocol/v0.3.0/docs/integration/operational-evidence-profile.md"
    );
    expect(snapshotReadme).toContain("release tag `v0.3.0`");
    expect(snapshotReadme).toContain(
      "https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.3.0"
    );
  });

  it("documents Flow-side X-Gate 3 Track A closure evidence without host-local paths", async () => {
    const [readme, docsIndex, closure] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8"),
      readFile(flowClosurePath, "utf8")
    ]);

    expect(readme).toContain("docs/x-gate3-track-a-flow-closure.md");
    expect(docsIndex).toContain("x-gate3-track-a-flow-closure.md");

    for (const requiredText of [
      "Flow-side X-Gate 3 Track A contribution is complete",
      "03d4175b11fd5cd888b04ceb865453933da885ac",
      "#82",
      "#88",
      "#96",
      "#97",
      "#101",
      "#102",
      "#103",
      "Ensen-protocol issue #50",
      "Ensen-protocol PR #51",
      "v0.3.0",
      "npm run build",
      "npm test",
      "node dist/index.js issue-lint 104 --config supervisor.config.coderabbit.json",
      "Ensen-general/Roadmap/X-Gate 3 Track A safety tracker.md",
      "Ensen-general/Roadmap/Latest Roadmap.md",
      "Overall X-Gate 3 Track A remains blocked by non-Flow Loop Track A work",
      "customer repo execution",
      "ERPNext live connector",
      "regulated data",
      "live write-back",
      "electronic signature",
      "batch release",
      "final disposition",
      "compliance claims"
    ]) {
      expect(closure).toContain(requiredText);
    }

    expect(closure).not.toMatch(posixHomeRootPattern);
    expect(closure).not.toMatch(linuxHomeRootPattern);
    expect(closure).not.toMatch(windowsHomeRootPattern);
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
