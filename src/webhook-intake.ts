import { createHash } from "node:crypto";
import { join } from "node:path";

import type { WorkflowRunState } from "./workflow-run-state.js";
import { readWorkflowRunState } from "./workflow-run-state.js";
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
  const statePath = join(options.stateRoot, `${runId}.jsonl`);
  const inputFingerprint = createWebhookInputFingerprint(normalizedInput);

  await assertExistingWebhookInputMatches(statePath, inputFingerprint);

  return runWorkflow({
    definition,
    statePath,
    auditPath: options.auditPath,
    runId,
    triggerContext: {
      requestId: normalizedInput.requestId,
      webhook: {
        inputFingerprint,
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

const rejectCredentialShapedValue = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectCredentialShapedValue(item, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      throw new WebhookIntakeRejectedError(`${path}.${key} looks credential-shaped`);
    }

    rejectCredentialShapedValue(nestedValue, `${path}.${key}`);
  }
};

const rejectCredentialShapedKeys = (value: Record<string, unknown>, path: string): void => {
  rejectCredentialShapedValue(value, path);
};

const assertExistingWebhookInputMatches = async (
  statePath: string,
  inputFingerprint: string
): Promise<void> => {
  const existingState = await readExistingWebhookRunState(statePath);
  if (existingState === undefined) {
    return;
  }

  const existingFingerprint =
    readStoredWebhookInputFingerprint(existingState) ??
    deriveLegacyWebhookInputFingerprint(existingState);
  if (existingFingerprint !== inputFingerprint) {
    throw new WebhookIntakeRejectedError(
      "webhook requestId reuse must keep normalized input unchanged"
    );
  }
};

const readExistingWebhookRunState = async (
  statePath: string
): Promise<WorkflowRunState | undefined> => {
  try {
    return await readWorkflowRunState(statePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const readStoredWebhookInputFingerprint = (state: WorkflowRunState): string | undefined => {
  const triggerContext = state.run.trigger.context;
  if (triggerContext === undefined) {
    return undefined;
  }

  const webhook = triggerContext.webhook;
  if (!isRecord(webhook)) {
    return undefined;
  }

  return typeof webhook.inputFingerprint === "string" ? webhook.inputFingerprint : undefined;
};

const deriveLegacyWebhookInputFingerprint = (
  state: WorkflowRunState
): string | undefined => {
  const triggerContext = state.run.trigger.context;
  if (!isRecord(triggerContext) || !isRecord(triggerContext.webhook)) {
    return undefined;
  }

  const webhook = triggerContext.webhook;
  const requestId = triggerContext.requestId;
  const headers = readLegacyWebhookHeaders(webhook.headers);
  if (
    typeof requestId !== "string" ||
    typeof webhook.path !== "string" ||
    typeof webhook.receivedAt !== "string" ||
    !isRecord(webhook.payload) ||
    headers === null
  ) {
    return undefined;
  }

  return createWebhookInputFingerprint({
    schemaVersion: WEBHOOK_INPUT_SCHEMA_VERSION,
    requestId,
    path: webhook.path,
    receivedAt: webhook.receivedAt,
    ...(headers === undefined ? {} : { headers }),
    payload: webhook.payload
  });
};

const readLegacyWebhookHeaders = (
  value: unknown
): Record<string, string> | undefined | null => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      return null;
    }
    headers[key] = headerValue;
  }

  return headers;
};

const createWebhookInputFingerprint = (input: WebhookInput): string =>
  createHash("sha256")
    .update(stableStringify(input))
    .digest("hex");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
};

const createWebhookRunId = (workflowId: string, requestId: string): string => {
  const slug =
    requestId
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "request";
  const fingerprint = createHash("sha256").update(requestId).digest("hex").slice(0, 12);
  return `${workflowId}-webhook-${slug}-${fingerprint}`;
};

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

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
