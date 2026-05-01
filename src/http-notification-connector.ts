import {
  createUnsupportedConnectorOperationResult
} from "./connector.js";
import type {
  ConnectorCapabilities,
  ConnectorOperationSupport,
  ConnectorResult,
  ConnectorSubmitRequest
} from "./connector.js";

export type HttpNotificationMethod = "POST" | "PUT" | "PATCH";
export type HttpNotificationOutcomeStatus = "succeeded" | "failed";

export interface HttpNotificationTarget {
  endpointAlias: string;
  method?: HttpNotificationMethod;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
}

export interface HttpNotificationSubmitRequest extends ConnectorSubmitRequest {
  idempotencyKey: string;
  attempt?: number;
  notification: HttpNotificationTarget;
}

export interface HttpNotificationOutcome {
  status: HttpNotificationOutcomeStatus;
  summary?: string;
  retryable?: boolean;
  evidence?: Record<string, unknown>;
}

export interface HttpNotificationReceipt {
  requestId: string;
  acceptedAt: string;
  notification: {
    status: HttpNotificationOutcomeStatus;
    endpointAlias: string;
    method: HttpNotificationMethod;
    attempt: number;
    idempotencyKey: string;
    summary?: string;
    retryable?: boolean;
  };
  evidence: Record<string, unknown>;
}

export type HttpNotificationSubmitResult = ConnectorResult<HttpNotificationReceipt>;

export interface HttpNotificationCapabilities extends ConnectorCapabilities {
  notify: ConnectorOperationSupport;
}

export interface HttpNotificationTransportDelivery {
  workflowId: string;
  runId: string;
  stepId: string;
  requestId: string;
  idempotencyKey: string;
  attempt: number;
  endpointAlias: string;
  method: HttpNotificationMethod;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
}

export interface HttpNotificationTransport {
  capabilities?: {
    notify?: ConnectorOperationSupport;
  };
  deliver(
    delivery: HttpNotificationTransportDelivery
  ): Promise<HttpNotificationOutcome> | HttpNotificationOutcome;
}

export interface FakeHttpNotificationTransport extends HttpNotificationTransport {
  readonly deliveries: HttpNotificationTransportDelivery[];
}

export interface CreateHttpNotificationConnectorInput {
  connectorId?: string;
  transport: HttpNotificationTransport;
  now?: () => string;
}

export interface CreateFakeHttpNotificationTransportInput {
  capabilities?: {
    notify?: ConnectorOperationSupport;
  };
  outcomes?: HttpNotificationOutcome[];
}

export interface HttpNotificationConnector {
  identity: {
    id: string;
    displayName: string;
    version: "flow.http-notification.v1";
  };
  capabilities: HttpNotificationCapabilities;
  submit(request: HttpNotificationSubmitRequest): Promise<HttpNotificationSubmitResult>;
  status(request: { requestId: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
  cancel(request: { requestId: string; reason?: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
  fetchEvidence(request: { requestId: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
}

interface IdempotencyRecord {
  receipt: HttpNotificationReceipt;
  fingerprint: string;
}

const defaultStatusReason = "HTTP notification skeleton records local submit outcomes only";
const defaultCancelReason = "HTTP notification skeleton does not support cancellation";
const defaultEvidenceReason = "HTTP notification skeleton does not fetch external evidence";
const stableAliasPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const credentialKeyPattern = /(^|[-_])(authorization|cookie|password|secret|token|api[-_]?key)([-_]|$)/i;

export const createHttpNotificationConnector = (
  input: CreateHttpNotificationConnectorInput
): HttpNotificationConnector => {
  const connectorId = input.connectorId ?? "http-notification";
  const now = input.now ?? (() => new Date().toISOString());
  const capabilities = createHttpNotificationCapabilities(input.transport.capabilities?.notify);
  const successfulReceipts = new Map<string, IdempotencyRecord>();

  const unsupported = (reason: string) =>
    createUnsupportedConnectorOperationResult({
      connectorId,
      operation: "submit",
      reason
    });

  return {
    identity: {
      id: connectorId,
      displayName: "HTTP Notification Connector",
      version: "flow.http-notification.v1"
    },
    capabilities,
    async submit(request: HttpNotificationSubmitRequest): Promise<HttpNotificationSubmitResult> {
      if (!capabilities.notify.supported) {
        return unsupported(capabilities.notify.reason);
      }

      const validationError = validateSubmitRequest(request);
      if (validationError !== undefined) {
        return invalidRequest(connectorId, validationError);
      }

      const method = request.notification.method ?? "POST";
      const fingerprint = fingerprintNotificationRequest(request, method);
      const replayed = successfulReceipts.get(request.idempotencyKey);
      if (replayed !== undefined) {
        if (replayed.fingerprint !== fingerprint) {
          return invalidRequest(
            connectorId,
            "HTTP notification idempotencyKey reuse must keep workflowId/runId/stepId/endpointAlias/method/headers/payload unchanged"
          );
        }

        return {
          ok: true,
          connectorId,
          operation: "submit",
          value: replayed.receipt
        };
      }

      const attempt = request.attempt ?? 1;
      const requestId = formatRequestId(connectorId, request.runId, request.stepId, attempt);
      const outcome = await input.transport.deliver({
        workflowId: request.workflowId,
        runId: request.runId,
        stepId: request.stepId,
        requestId,
        idempotencyKey: request.idempotencyKey,
        attempt,
        endpointAlias: request.notification.endpointAlias,
        method,
        ...(request.notification.headers === undefined
          ? {}
          : { headers: request.notification.headers }),
        ...(request.notification.payload === undefined
          ? {}
          : { payload: request.notification.payload })
      });

      if (outcome.status === "failed") {
        return {
          ok: false,
          connectorId,
          operation: "submit",
          error: {
            code: "execution-failed",
            message: outcome.summary ?? "HTTP notification failed in local fake transport",
            retryable: outcome.retryable === true
          }
        };
      }

      const acceptedAt = now();
      const receipt: HttpNotificationReceipt = {
        requestId,
        acceptedAt,
        notification: {
          status: outcome.status,
          endpointAlias: request.notification.endpointAlias,
          method,
          attempt,
          idempotencyKey: request.idempotencyKey,
          ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
          ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable })
        },
        evidence: {
          kind: "http-notification-local",
          endpointAlias: request.notification.endpointAlias,
          attempt,
          idempotencyKey: request.idempotencyKey,
          ...(outcome.evidence === undefined ? {} : { transport: outcome.evidence })
        }
      };
      successfulReceipts.set(request.idempotencyKey, { receipt, fingerprint });

      return {
        ok: true,
        connectorId,
        operation: "submit",
        value: receipt
      };
    },
    status() {
      return createUnsupportedConnectorOperationResult({
        connectorId,
        operation: "status",
        reason: defaultStatusReason
      });
    },
    cancel() {
      return createUnsupportedConnectorOperationResult({
        connectorId,
        operation: "cancel",
        reason: defaultCancelReason
      });
    },
    fetchEvidence() {
      return createUnsupportedConnectorOperationResult({
        connectorId,
        operation: "fetchEvidence",
        reason: defaultEvidenceReason
      });
    }
  };
};

export const createFakeHttpNotificationTransport = (
  input: CreateFakeHttpNotificationTransportInput = {}
): FakeHttpNotificationTransport => {
  const deliveries: HttpNotificationTransportDelivery[] = [];
  const outcomes =
    input.outcomes === undefined || input.outcomes.length === 0
      ? [{ status: "succeeded" as const, summary: "local fake notification accepted" }]
      : input.outcomes;

  return {
    capabilities: input.capabilities,
    get deliveries() {
      return deliveries.map((delivery) => ({ ...delivery }));
    },
    deliver(delivery: HttpNotificationTransportDelivery): HttpNotificationOutcome {
      deliveries.push({ ...delivery });

      return outcomes[Math.min(deliveries.length - 1, outcomes.length - 1)];
    }
  };
};

const createHttpNotificationCapabilities = (
  notifyOverride: ConnectorOperationSupport | undefined
): HttpNotificationCapabilities => {
  const notify = notifyOverride ?? { supported: true as const };

  return {
    notify,
    submit: notify,
    status: { supported: false, reason: defaultStatusReason },
    cancel: { supported: false, reason: defaultCancelReason },
    fetchEvidence: { supported: false, reason: defaultEvidenceReason }
  };
};

const validateSubmitRequest = (request: HttpNotificationSubmitRequest): string | undefined => {
  if (typeof request.workflowId !== "string" || request.workflowId.trim().length === 0) {
    return "HTTP notification workflowId must be a non-empty string";
  }

  if (typeof request.runId !== "string" || request.runId.trim().length === 0) {
    return "HTTP notification runId must be a non-empty string";
  }

  if (typeof request.stepId !== "string" || request.stepId.trim().length === 0) {
    return "HTTP notification stepId must be a non-empty string";
  }

  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.trim().length === 0) {
    return "HTTP notification idempotencyKey must be a non-empty string";
  }

  if (
    request.attempt !== undefined &&
    (!Number.isInteger(request.attempt) || request.attempt < 1)
  ) {
    return "HTTP notification attempt must be a positive integer";
  }

  if (!isRecord(request.notification)) {
    return "HTTP notification target must be an object";
  }

  if (
    typeof request.notification.endpointAlias !== "string" ||
    !stableAliasPattern.test(request.notification.endpointAlias)
  ) {
    return "HTTP notification endpointAlias must be a stable local alias, not a URL or secret";
  }

  if (
    request.notification.method !== undefined &&
    !["POST", "PUT", "PATCH"].includes(request.notification.method)
  ) {
    return "HTTP notification method must be POST, PUT, or PATCH";
  }

  const credentialKey = findCredentialShapedKey(request.notification);
  if (credentialKey !== undefined) {
    return `HTTP notification fixture must not include credential-shaped field ${credentialKey}`;
  }

  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findCredentialShapedKey = (value: unknown, path = "notification"): string | undefined => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findCredentialShapedKey(value[index], `${path}[${index}]`);
      if (nested !== undefined) {
        return nested;
      }
    }

    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (credentialKeyPattern.test(key)) {
      return nestedPath;
    }
    const nested = findCredentialShapedKey(nestedValue, nestedPath);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
};

const invalidRequest = (
  connectorId: string,
  message: string
): HttpNotificationSubmitResult => ({
  ok: false,
  connectorId,
  operation: "submit",
  error: {
    code: "invalid-request",
    message,
    retryable: false
  }
});

const formatRequestId = (
  connectorId: string,
  runId: string,
  stepId: string,
  attempt: number
): string => `${connectorId}-${runId}-${stepId}-attempt-${attempt}`;

const fingerprintNotificationRequest = (
  request: HttpNotificationSubmitRequest,
  method: HttpNotificationMethod
): string =>
  stableStringify({
    workflowId: request.workflowId,
    runId: request.runId,
    stepId: request.stepId,
    endpointAlias: request.notification.endpointAlias,
    method,
    headers: request.notification.headers ?? null,
    payload: request.notification.payload ?? null
  });

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};
