import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  eipVersionBoundary,
  isSupportedEipProtocolVersion
} from "../src/index.js";

const snapshotRoot = join(
  process.cwd(),
  "protocol-snapshots",
  "ensen-protocol",
  "v0.1.0"
);

const expectedSchemas = [
  "schemas/eip.evidence-bundle-ref.v1.schema.json",
  "schemas/eip.run-request.v1.schema.json",
  "schemas/eip.run-result.v1.schema.json",
  "schemas/eip.run-status.v1.schema.json"
];

const supportSchemas = ["schemas/eip.common.v1.schema.json"];

const expectedFixtureFamilies = [
  "evidence-bundle-ref",
  "run-request",
  "run-result",
  "run-status"
];

const readJson = async (relativePath: string): Promise<unknown> =>
  JSON.parse(await readFile(join(snapshotRoot, relativePath), "utf8")) as unknown;

const listJsonFixtures = async (relativePath: string): Promise<string[]> => {
  const entries = await readdir(join(snapshotRoot, relativePath), {
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
};

describe("Ensen-protocol snapshot boundary", () => {
  it("vendors the Ensen-protocol v0.1.0 protocol snapshot with provenance", async () => {
    await expect(readJson("manifest.json")).resolves.toEqual({
      source: {
        repository: "TommyKammy/Ensen-protocol",
        releaseTag: "v0.1.0",
        protocolVersion: "0.1.0"
      },
      policy: {
        updatePolicy:
          "Copied snapshot. Update only by replacing this directory from a tagged Ensen-protocol release.",
        runtimeDependency: false,
        localCorrections: [
          {
            path: "fixtures/evidence-bundle-ref/v1/invalid/raw-secret-uri.json",
            reason: "Use a scanner-safe invalid URI placeholder."
          },
          {
            path: "fixtures/run-request/v1/invalid/raw-secret.json",
            reason:
              "Keep the invalid fixture deterministically invalid under ExtensionMap rules."
          },
          {
            path: "schemas/eip.run-result.v1.schema.json",
            reason:
              "Require VerificationSummary.status for unambiguous verification payloads."
          }
        ]
      },
      includes: {
        schemas: expectedSchemas,
        supportSchemas,
        fixtureFamilies: expectedFixtureFamilies
      }
    });

    for (const schemaPath of [...expectedSchemas, ...supportSchemas]) {
      await expect(readJson(schemaPath)).resolves.toEqual(expect.any(Object));
    }
  });

  it("includes valid and invalid fixtures for each Phase 2 EIP surface", async () => {
    for (const fixtureFamily of expectedFixtureFamilies) {
      const validFixturePath = join("fixtures", fixtureFamily, "v1", "valid");
      const invalidFixturePath = join("fixtures", fixtureFamily, "v1", "invalid");
      const validFixtures = await listJsonFixtures(validFixturePath);
      const invalidFixtures = await listJsonFixtures(invalidFixturePath);

      expect(validFixtures).not.toHaveLength(0);
      expect(invalidFixtures).not.toHaveLength(0);

      for (const fixtureName of validFixtures) {
        await expect(readJson(join(validFixturePath, fixtureName))).resolves.toEqual(
          expect.any(Object)
        );
      }

      for (const fixtureName of invalidFixtures) {
        await expect(readJson(join(invalidFixturePath, fixtureName))).resolves.toEqual(
          expect.any(Object)
        );
      }
    }
  });

  it("exposes a fail-closed EIP version boundary without a runtime protocol dependency", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as Record<
      string,
      unknown
    >;

    for (const dependencyKey of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundledDependencies",
      "bundleDependencies",
      "peerDependenciesMeta",
      "overrides"
    ]) {
      const dependencyBucket = packageJson[dependencyKey];
      expect(JSON.stringify(dependencyBucket ?? {})).not.toContain("ensen-protocol");
    }

    expect(eipVersionBoundary).toEqual({
      sourceRepository: "TommyKammy/Ensen-protocol",
      snapshotReleaseTag: "v0.1.0",
      supportedProtocolVersion: "0.1.0",
      runtimeDependency: false,
      unsupportedMajorVersionPolicy:
        "fail-closed until an explicit Ensen-flow connector boundary supports the new EIP major version"
    });
    expect(isSupportedEipProtocolVersion("0.1.0")).toBe(true);
    expect(isSupportedEipProtocolVersion("1.0.0")).toBe(false);
    expect(isSupportedEipProtocolVersion("bad-version")).toBe(false);
  });
});
