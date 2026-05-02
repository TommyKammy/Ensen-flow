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
  "v0.2.0"
);

const expectedSchemas = [
  "schemas/eip.audit-event.v1.schema.json",
  "schemas/eip.evidence-bundle-ref.v1.schema.json",
  "schemas/eip.run-request.v1.schema.json",
  "schemas/eip.run-result.v1.schema.json",
  "schemas/eip.run-status.v1.schema.json"
];

const supportSchemas = ["schemas/eip.common.v1.schema.json"];

const expectedFixtureFamilies = [
  "audit-event",
  "capability-variants",
  "common",
  "evidence-bundle-ref",
  "run-request",
  "run-result",
  "run-status"
];

const validOnlyFixtureFamilies = ["capability-variants"];
const fixtureFamiliesWithInvalidFixtures = expectedFixtureFamilies.filter(
  (fixtureFamily) => !validOnlyFixtureFamilies.includes(fixtureFamily)
);

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
  it("vendors the Ensen-protocol v0.2.0 protocol snapshot with provenance", async () => {
    await expect(readJson("manifest.json")).resolves.toEqual({
      source: {
        repository: "TommyKammy/Ensen-protocol",
        releaseTag: "v0.2.0",
        protocolVersion: "0.2.0",
        tagObjectSha: "8fc4fa5ea4a7dcf355363980650d46e62ddd0651",
        targetCommit: "19c62f404101a1d0c00af8d011874c99f9c52189"
      },
      policy: {
        updatePolicy:
          "Copied snapshot. Update only by replacing this directory from a tagged Ensen-protocol release.",
        runtimeDependency: false,
        localCorrections: [],
        copiedArtifactsUnmodified: true
      },
      includes: {
        schemas: expectedSchemas,
        supportSchemas,
        fixtureFamilies: expectedFixtureFamilies,
        contractDocs: expect.arrayContaining([
          "docs/EIP-0001-run-request.md",
          "docs/EIP-0005-run-status-snapshot.md",
          "docs/integration/executor-transport-capabilities.md",
          "docs/integration/transport-error-mapping-and-retryability.md"
        ])
      },
      validationEvidence: {
        recordedFromSourceRelease: true,
        commands: [
          "npm test",
          "npm run check:fixtures",
          "npm run check:public-fixtures",
          "npm run check:schema-ids",
          "npm run check:spec-boundary"
        ]
      },
      intentionalExclusions: expect.arrayContaining([
        expect.stringContaining("No Ensen-protocol package"),
        expect.stringContaining("Flow-local workflow examples"),
        expect.stringContaining("Copied capability variant fixtures")
      ])
    });

    for (const schemaPath of [...expectedSchemas, ...supportSchemas]) {
      await expect(readJson(schemaPath)).resolves.toEqual(expect.any(Object));
    }
  });

  it("includes valid and invalid fixtures for each copied EIP surface that defines both", async () => {
    for (const fixtureFamily of fixtureFamiliesWithInvalidFixtures) {
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

  it("includes Phase 3 capability variant examples as valid conformance fixtures", async () => {
    for (const fixtureFamily of validOnlyFixtureFamilies) {
      const validFixturePath = join("fixtures", fixtureFamily, "v1", "valid");
      const validFixtures = await listJsonFixtures(validFixturePath);

      expect(validFixtures).not.toHaveLength(0);

      for (const fixtureName of validFixtures) {
        await expect(readJson(join(validFixturePath, fixtureName))).resolves.toEqual(
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
      snapshotReleaseTag: "v0.2.0",
      supportedProtocolVersion: "0.2.0",
      runtimeDependency: false,
      unsupportedMajorVersionPolicy:
        "fail-closed until an explicit Ensen-flow connector boundary supports the new EIP major version"
    });
    expect(isSupportedEipProtocolVersion("0.2.0")).toBe(true);
    expect(isSupportedEipProtocolVersion("1.0.0")).toBe(false);
    expect(isSupportedEipProtocolVersion("bad-version")).toBe(false);
  });
});
