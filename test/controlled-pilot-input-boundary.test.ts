import { describe, expect, it } from "vitest";

import { explainControlledPilotBoundaryRejection } from "../src/index.js";
import type { ControlledPilotInputBoundary } from "../src/index.js";

describe("controlled pilot input boundary", () => {
  const malformedRealBoundary = (
    patch: Record<string, unknown>
  ): ControlledPilotInputBoundary =>
    ({
      mode: "real",
      dryRunFirstEvidence: {
        mode: "dry-run",
        reference: "docs/connector-capability-matrix.md"
      },
      override: {
        approvedBy: "owner",
        approvedAt: "2026-05-03T00:00:00.000Z",
        reason: "controlled owner pilot"
      },
      ...patch
    }) as unknown as ControlledPilotInputBoundary;

  it("rejects malformed missing boundary input without throwing", () => {
    expect(() =>
      explainControlledPilotBoundaryRejection({
        surface: "HTTP notification transport",
        boundary: null as unknown as ControlledPilotInputBoundary
      })
    ).not.toThrow();
    expect(
      explainControlledPilotBoundaryRejection({
        surface: "HTTP notification transport",
        boundary: null as unknown as ControlledPilotInputBoundary
      })
    ).toBe(
      "HTTP notification transport must declare a fake, local, or dry-run input boundary before controlled pilot use"
    );
  });

  it("rejects malformed real input evidence and override fields without throwing", () => {
    const expectedReason =
      "HTTP notification transport real input requires explicit dry-run-first evidence and a human-controlled override";
    const boundaries = [
      malformedRealBoundary({
        dryRunFirstEvidence: null
      }),
      malformedRealBoundary({
        override: null
      }),
      malformedRealBoundary({
        dryRunFirstEvidence: { mode: "dry-run", reference: 42 }
      }),
      malformedRealBoundary({
        override: {
          approvedBy: ["owner"],
          approvedAt: "2026-05-03T00:00:00.000Z",
          reason: "controlled owner pilot"
        }
      }),
      malformedRealBoundary({
        override: {
          approvedBy: "owner",
          approvedAt: null,
          reason: "controlled owner pilot"
        }
      }),
      malformedRealBoundary({
        override: {
          approvedBy: "owner",
          approvedAt: "2026-05-03T00:00:00.000Z",
          reason: { ticket: "pilot-approval" }
        }
      })
    ];

    for (const boundary of boundaries) {
      expect(() =>
        explainControlledPilotBoundaryRejection({
          surface: "HTTP notification transport",
          boundary
        })
      ).not.toThrow();
      expect(
        explainControlledPilotBoundaryRejection({
          surface: "HTTP notification transport",
          boundary
        })
      ).toBe(expectedReason);
    }
  });
});
