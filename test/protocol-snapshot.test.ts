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
const operationalEvidenceSnapshotRoot = join(
  process.cwd(),
  "protocol-snapshots",
  "ensen-protocol",
  "v0.3.0"
);
const unsafeSnapshotTextPatterns = [
  {
    name: "posix user-home path",
    pattern: new RegExp(["", "Users", "[A-Za-z0-9._-]+"].join("\\/"))
  },
  {
    name: "linux user-home path",
    pattern: new RegExp(["", "home", "[A-Za-z0-9._-]+"].join("\\/"))
  },
  {
    name: "windows user-home path",
    pattern: new RegExp(["[A-Za-z]:", "Users", ""].join("\\\\"))
  },
  {
    name: "unsafe local file URI",
    pattern: new RegExp(
      [
        "file:",
        "",
        "",
        "(?:Users|home|private|tmp|var|opt|etc|srv|mnt|root|Volumes|usr|[A-Za-z]:)"
      ].join("\\/")
    )
  },
  { name: "network file URI", pattern: /file:\/\/[^/<>\s]+\/[^<>\s]+/i },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "raw secret assignment",
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?key)=\S+/i
  },
  {
    name: "raw token assignment",
    pattern: /\btoken=\S+/i
  },
  {
    name: "token-shaped value",
    pattern: /\b(?:ghp|github_pat|glpat|xox[abprs]|sk)[-_][A-Za-z0-9_-]{8,}\b/i
  },
  {
    name: "session cookie",
    pattern: /\b(?:cookie|set-cookie)\s*:\s*[^;\n]*(?:session|sid)=|\b(?:sessionid|session_id|sid)=/i
  },
  {
    name: "customer data literal",
    pattern: /\b(?:customer(?:Id|Name|Email)|accountNumber|ssn)\s*[:=]\s*["']?[^"',\s]+/i
  },
  {
    name: "credential-bearing database URI",
    pattern: /\b(?:postgres|mysql|mongodb):\/\/[^<\s]+:[^<\s]+@/i
  }
];

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

const readOperationalEvidenceJson = async (
  relativePath: string
): Promise<unknown> =>
  JSON.parse(
    await readFile(join(operationalEvidenceSnapshotRoot, relativePath), "utf8")
  ) as unknown;

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
        localCorrections: [
          {
            reason: expect.stringContaining("stale v0.1.0 references"),
            paths: expect.arrayContaining([
              "fixtures/README.md",
              "fixtures/capability-variants/v1/valid/submit-only-no-polling.json"
            ])
          }
        ],
        copiedArtifactsUnmodified: false
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
        expect.stringContaining("stale upstream v0.1.0 provenance")
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

  it("keeps Phase 3 capability variant provenance aligned to the v0.2.0 snapshot", async () => {
    const validFixturePath = join("fixtures", "capability-variants", "v1", "valid");
    const validFixtures = await listJsonFixtures(validFixturePath);

    for (const fixtureName of validFixtures) {
      const fixture = (await readJson(join(validFixturePath, fixtureName))) as {
        protocolSnapshot?: unknown;
      };

      expect(fixture.protocolSnapshot).toEqual({
        tag: "v0.2.0",
        commit: "19c62f4",
        issue: "https://github.com/TommyKammy/Ensen-protocol/issues/43"
      });
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

  it("vendors the Ensen-protocol v0.3.0 operational evidence profile snapshot", async () => {
    await expect(
      readOperationalEvidenceJson("manifest.json")
    ).resolves.toEqual({
      source: {
        repository: "TommyKammy/Ensen-protocol",
        releaseTag: "v0.3.0",
        releaseUrl:
          "https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.3.0",
        protocolVersion: "0.3.0",
        tagObjectSha: "080c46471e02d666367b1a18413beb46ebbc2f5b",
        targetCommit: "bb7a3fe06dc09bc0675fca0de44194b2eb17dc9b"
      },
      policy: {
        updatePolicy:
          "Copied snapshot. Update only by replacing this directory from a tagged Ensen-protocol release.",
        runtimeDependency: false,
        copiedArtifactsUnmodified: true
      },
      includes: {
        profileDocs: ["docs/integration/operational-evidence-profile.md"],
        fixtureFamilies: ["operational-evidence-profile"],
        publicFixtureSafeExamples: [
          "fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json"
        ]
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
        expect.stringContaining("No Ensen-protocol runtime"),
        expect.stringContaining("No production evidence archive"),
        expect.stringContaining("v0.2.0 schema snapshot remains")
      ])
    });

    const profileDoc = await readFile(
      join(
        operationalEvidenceSnapshotRoot,
        "docs/integration/operational-evidence-profile.md"
      ),
      "utf8"
    );
    const publicExample = (await readOperationalEvidenceJson(
      "fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json"
    )) as {
      evidence?: { dataClassification?: unknown; checksum?: unknown };
      producerMetadata?: Record<string, unknown>;
      confidentialReferencePolicy?: { allowedInPublicFixture?: unknown };
      retentionHint?: unknown;
    };

    expect(profileDoc).toContain("Operational Evidence Profile");
    expect(profileDoc).toContain("not artifact storage, not cleanup, not recovery");
    expect(publicExample.evidence?.dataClassification).toBe("public");
    expect(publicExample.evidence?.checksum).toEqual({
      algorithm: "sha256",
      value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });
    expect(publicExample.producerMetadata).toEqual(
      expect.objectContaining({
        command: "npm test",
        boundary: "parser"
      })
    );
    expect(publicExample.retentionHint).toBe("publicFixture");
    expect(publicExample.confidentialReferencePolicy?.allowedInPublicFixture).toBe(
      false
    );

    for (const snapshotText of [
      await readFile(
        join(operationalEvidenceSnapshotRoot, "README.md"),
        "utf8"
      ),
      await readFile(
        join(operationalEvidenceSnapshotRoot, "manifest.json"),
        "utf8"
      ),
      profileDoc,
      JSON.stringify(publicExample, null, 2)
    ]) {
      for (const { name, pattern } of unsafeSnapshotTextPatterns) {
        expect(snapshotText, `snapshot text must not contain ${name}`).not.toMatch(
          pattern
        );
      }
    }
  });
});
