import { describe, expect, it } from "vitest";

import { baselineInfo } from "../src/index.js";

describe("baseline package scaffold", () => {
  it("exposes only the Phase 1 baseline boundary", () => {
    expect(baselineInfo).toEqual({
      packageName: "@tommykammy/ensen-flow",
      phase: "phase-1-baseline",
      runtimeFeaturesEnabled: false
    });
  });
});
