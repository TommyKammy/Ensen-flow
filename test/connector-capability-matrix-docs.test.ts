import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const matrixPath = "docs/connector-capability-matrix.md";
const readmePath = "README.md";
const docsIndexPath = "docs/README.md";
const posixHomeRootPattern = new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"));
const linuxHomeRootPattern = new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"));
const windowsHomeRootPattern = new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"));

describe("connector capability matrix docs", () => {
  it("documents Phase 4 connector capability boundaries without production claims", async () => {
    const matrix = await readFile(matrixPath, "utf8");

    for (const requiredText of [
      "schedule trigger",
      "webhook intake",
      "HTTP notification connector",
      "local file connector",
      "executor connector",
      "fake/local-only",
      "unsupported",
      "deferred",
      "retry",
      "idempotency",
      "approval-required",
      "status",
      "cancel",
      "fetchEvidence",
      "v0.2.0",
      "Polling support",
      "Evidence reference support",
      "idempotency expectation",
      "unsupported cancel behavior",
      "Ambiguous capability vocabulary is routed to Ensen-protocol",
      "Ensen-flow remains standalone",
      "not an Ensen-loop wrapper",
      "no production integration claim",
      "no ERPNext",
      "no Pharma/GxP",
      "no compliance claim",
      "TommyKammy/Ensen-protocol#28"
    ]) {
      expect(matrix).toContain(requiredText);
    }

    expect(matrix).not.toMatch(posixHomeRootPattern);
    expect(matrix).not.toMatch(linuxHomeRootPattern);
    expect(matrix).not.toMatch(windowsHomeRootPattern);
  });

  it("links the matrix from public documentation navigation", async () => {
    const [readme, docsIndex] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(docsIndexPath, "utf8"),
    ]);

    expect(readme).toContain("docs/connector-capability-matrix.md");
    expect(docsIndex).toContain("connector-capability-matrix.md");
  });
});
