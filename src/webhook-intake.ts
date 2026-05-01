import { join } from "node:path";

import type { WorkflowRunState } from "./workflow-run-state.js";
import { validateWorkflowDefinition } from "./workflow-definition.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import { runWorkflow } from "./workflow-runner.js";
import type { WorkflowStepHandler } from "./workflow-runner.js";

const WEBHOOK_INPUT_SCHEMA_VERSION = "flow.webhook.input.v1";
const MAX_HEADER_COUNT = 20;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_JSON_DEPTH = 6;
const MAX_JSON_STRING_LENGTH = 2048;
const MAX_JSON_ARRAY_LENGTH = 50;
const MAX_JSON_OBJECT_KEYS = 50;
const WEBHOOK_PATH_PATTERN = /^\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;
const WEBHOOK_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_UTC_MILLIS_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;
const WEBHOOK_INPUT_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "requestId",
  "path",
  "receivedAt",
  "headers",
  "payload"
]);
const BLOCKED_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-signature",
  "x-webhook-signature",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
  "host",
  "x-tenant-id",
  "x-user-id"
]);
const CREDENTIAL_KEY_PATTERN = /(?:secret|token|password|credential|api[-_]?key|signature)/i;

export interface WebhookInput {
  schemaVersion: typeof WEBHOOK_INPUT_SCHEMA_VERSION;
  requestId: string;
  path: string;
  receivedAt: string;
  headers?: Record<string, string>;
  payload: Record<string, unknown>;
}

export interface ConsumeWebhookInputOptions {
  definition: WorkflowDefinition;
  stateRoot: string;
  auditPath?: string;
  input: WebhookInput;
  now?: () => string;
  stepHandler?: WorkflowStepHandler;
}

export class WebhookIntakeRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookIntakeRejectedError";
  }
}

export const webhookInputSchemaVersion = WEBHOOK_INPUT_SCHEMA_VERSION;

type WebhookWorkflowDefinition = WorkflowDefinition & {
  trigger: {
    type: "webhook";
    path: string;
  };
};

export const consumeWebhookInput = async (
  options: ConsumeWebhookInputOptions
): Promise<WorkflowRunState> => {
  const definition = assertWebhookWorkflow(options.definition);
  const normalizedInput = normalizeWebhookInput(options.input, definition.trigger.path);
  const runId = createWebhookRunId(definition.id, normalizedInput.requestId);

  return runWorkflow({
    definition,
    statePath: join(options.stateRoot, `${runId}.jsonl`),
    auditPath: options.auditPath,
    runId,
    triggerContext: {
      requestId: normalizedInput.requestId,
      webhook: {
        path: normalizedInput.path,
        receivedAt: normalizedInput.receivedAt,
        ...(normalizedInput.headers === undefined ? {} : { headers: normalizedInput.headers }),
        payload: normalizedInput.payload
      }
    },
    now: options.now,
    stepHandler: options.stepHandler
  });
};

const assertWebhookWorkflow = (definition: WorkflowDefinition): WebhookWorkflowDefinition => {
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new WebhookIntakeRejectedError(`workflow definition is invalid: ${details}`);
  }

  if (definition.trigger.type !== "webhook") {
    throw new WebhookIntakeRejectedError("consumeWebhookInput requires a webhook trigger workflow");
  }

  if (!WEBHOOK_PATH_PATTERN.test(definition.trigger.path)) {
    throw new WebhookIntakeRejectedError(
      "webhook trigger.path must be a local absolute path with stable kebab-case segments"
    );
  }

  return definition as WebhookWorkflowDefinition;
};

const normalizeWebhookInput = (value: unknown, expectedPath: string): WebhookInput => {
  if (!isRecord(value)) {
    throw new WebhookIntakeRejectedError("webhook input must be an object");
  }

  rejectUnknownKeys(value);

  if (value.schemaVersion !== WEBHOOK_INPUT_SCHEMA_VERSION) {
    throw new WebhookIntakeRejectedError(
      `webhook input schemaVersion must be ${WEBHOOK_INPUT_SCHEMA_VERSION}`
    );
  }

  if (
    typeof value.requestId !== "string" ||
    value.requestId.trim() === "" ||
    !WEBHOOK_REQUEST_ID_PATTERN.test(value.requestId)
  ) {
    throw new WebhookIntakeRejectedError(
      "webhook input requestId must be a bounded stable identifier"
    );
  }

  if (typeof value.path !== "string" || !WEBHOOK_PATH_PATTERN.test(value.path)) {
    throw new WebhookIntakeRejectedError(
      "webhook input path must be a local absolute path with stable kebab-case segments"
    );
  }

  if (value.path !== expectedPath) {
    throw new WebhookIntakeRejectedError("webhook input path must match workflow trigger.path");
  }

  if (typeof value.receivedAt !== "string" || !isStrictUtcMillisTimestamp(value.receivedAt)) {
    throw new WebhookIntakeRejectedError(
      "webhook input receivedAt must be an ISO-8601 UTC timestamp with milliseconds"
    );
  }

  const headers = normalizeHeaders(value.headers);
  if (!isRecord(value.payload)) {
    throw new WebhookIntakeRejectedError("webhook input payload must be an object");
  }
  validateBoundedJson(value.payload, "webhook input payload", 0);
  rejectCredentialShapedKeys(value.payload, "webhook input payload");

  return {
    schemaVersion: WEBHOOK_INPUT_SCHEMA_VERSION,
    requestId: value.requestId,
    path: value.path,
    receivedAt: value.receivedAt,
    ...(headers === undefined ? {} : { headers }),
    payload: value.payload
  };
};

const rejectUnknownKeys = (value: Record<string, unknown>): void => {
  for (const key of Object.keys(value)) {
    if (!WEBHOOK_INPUT_ALLOWED_KEYS.has(key)) {
      throw new WebhookIntakeRejectedError(
        `${key} is outside the webhook intake boundary`
      );
    }
  }
};

const normalizeHeaders = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new WebhookIntakeRejectedError("webhook input headers must be an object");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_HEADER_COUNT) {
    throw new WebhookIntakeRejectedError("webhook input headers exceed the bounded header count");
  }

  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new WebhookIntakeRejectedError("webhook input header names must be stable tokens");
    }

    if (BLOCKED_HEADER_NAMES.has(name)) {
      throw new WebhookIntakeRejectedError(
        "webhook headers must not include credential or forwarded boundary headers"
      );
    }

    if (typeof rawValue !== "string" || rawValue.length > MAX_HEADER_VALUE_LENGTH) {
      throw new WebhookIntakeRejectedError(
        "webhook input header values must be bounded strings"
      );
    }

    headers[name] = rawValue;
  }

  return headers;
};

const validateBoundedJson = (value: unknown, path: string, depth: number): void => {
  if (depth > MAX_JSON_DEPTH) {
    throw new WebhookIntakeRejectedError(`${path} exceeds the maximum JSON depth`);
  }

  if (value === null || typeof value === "boolean") {
    return;
  }

  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) {
      throw new WebhookIntakeRejectedError(`${path} string value is too large`);
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new WebhookIntakeRejectedError(`${path} must contain only finite numbers`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) {
      throw new WebhookIntakeRejectedError(`${path} array is too large`);
    }
    value.forEach((item, index) => validateBoundedJson(item, `${path}[${index}]`, depth + 1));
    return;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_JSON_OBJECT_KEYS) {
      throw new WebhookIntakeRejectedError(`${path} object has too many keys`);
    }
    keys.forEach((key) => validateBoundedJson(value[key], `${path}.${key}`, depth + 1));
    return;
  }

  throw new WebhookIntakeRejectedError(`${path} must contain only JSON values`);
};

const rejectCredentialShapedKeys = (value: Record<string, unknown>, path: string): void => {
  for (const [key, nestedValue] of Object.entries(value)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      throw new WebhookIntakeRejectedError(`${path}.${key} looks credential-shaped`);
    }

    if (isRecord(nestedValue)) {
      rejectCredentialShapedKeys(nestedValue, `${path}.${key}`);
    }
  }
};

const createWebhookRunId = (workflowId: string, requestId: string): string =>
  `${workflowId}-webhook-${requestId.toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-")}`;

const isStrictUtcMillisTimestamp = (value: string): boolean => {
  const match = ISO_UTC_MILLIS_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
