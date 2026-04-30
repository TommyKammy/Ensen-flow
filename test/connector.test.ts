import { describe, expect, it } from "vitest";

import {
  ConnectorOperationUnsupportedError,
  createImmediateOnlyConnectorCapabilities,
  createUnsupportedConnectorOperationResult
} from "../src/index.js";

describe("connector interface", () => {
  it("describes immediate-only connector capabilities without implying optional operation support", () => {
    const capabilities = createImmediateOnlyConnectorCapabilities({
      unsupportedReason: "manual connector completes inline"
    });

    expect(capabilities).toEqual({
      submit: { supported: true },
      status: {
        supported: false,
        reason: "manual connector completes inline"
      },
      cancel: {
        supported: false,
        reason: "manual connector completes inline"
      },
      fetchEvidence: {
        supported: false,
        reason: "manual connector completes inline"
      }
    });
  });

  it("returns an auditable fail-closed result for unsupported connector operations", () => {
    const result = createUnsupportedConnectorOperationResult({
      connectorId: "manual-inline",
      operation: "cancel",
      reason: "manual connector completes inline"
    });

    expect(result).toEqual({
      ok: false,
      connectorId: "manual-inline",
      operation: "cancel",
      error: {
        code: "unsupported-operation",
        message: "connector manual-inline does not support cancel: manual connector completes inline",
        retryable: false,
        reason: "manual connector completes inline"
      }
    });
  });

  it("exposes unsupported operation as a typed error for callers that throw", () => {
    const error = new ConnectorOperationUnsupportedError({
      connectorId: "manual-inline",
      operation: "fetchEvidence",
      reason: "manual connector completes inline"
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConnectorOperationUnsupportedError");
    expect(error.code).toBe("unsupported-operation");
    expect(error.connectorId).toBe("manual-inline");
    expect(error.operation).toBe("fetchEvidence");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(
      "connector manual-inline does not support fetchEvidence: manual connector completes inline"
    );
  });
});
