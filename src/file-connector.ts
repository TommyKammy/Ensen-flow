import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  normalize,
  parse,
  relative,
  resolve,
  sep
} from "node:path";

import {
  createUnsupportedConnectorOperationResult
} from "./connector.js";
import type {
  ConnectorCapabilities,
  ConnectorResult,
  ConnectorSubmitRequest
} from "./connector.js";
import {
  findUnsafeWorkflowArtifactValue,
  formatUnsafeWorkflowArtifactDiagnostic
} from "./workflow-artifact-hygiene.js";

export type LocalFileAction = "read" | "write";

export interface LocalFileAllowedRoot {
  alias: string;
  path: string;
}

export interface LocalFileRequest {
  action: LocalFileAction;
  rootAlias: string;
  path: string;
  content?: string;
}

export interface LocalFileSubmitRequest extends ConnectorSubmitRequest {
  idempotencyKey: string;
  file: LocalFileRequest;
}

export interface LocalFileReceipt {
  requestId: string;
  acceptedAt: string;
  file: {
    action: LocalFileAction;
    rootAlias: string;
    path: string;
    bytes: number;
    summary: string;
  };
  output?: {
    content: string;
  };
  evidence: {
    kind: "local-file-fixture";
    rootAlias: string;
    path: string;
    bytes: number;
  };
}

export type LocalFileSubmitResult = ConnectorResult<LocalFileReceipt>;

export interface LocalFileIdempotencyRecord {
  receipt: LocalFileReceipt;
  fingerprint: string;
}

export type LocalFileIdempotencyStoreResult =
  | {
      status: "stored" | "replayed";
      record: LocalFileIdempotencyRecord;
    }
  | {
      status: "conflict";
    };

export interface LocalFileIdempotencyStore {
  submitSuccessfulReceipt(input: {
    idempotencyKey: string;
    fingerprint: string;
    createReceipt: () => Promise<LocalFileReceipt>;
  }): Promise<LocalFileIdempotencyStoreResult>;
}

export interface CreateLocalFileConnectorInput {
  connectorId?: string;
  allowedRoots: LocalFileAllowedRoot[];
  idempotencyStore?: LocalFileIdempotencyStore;
  now?: () => string;
}

export interface LocalFileConnector {
  identity: {
    id: string;
    displayName: string;
    version: "flow.local-file.v1";
  };
  capabilities: ConnectorCapabilities;
  submit(request: LocalFileSubmitRequest): Promise<LocalFileSubmitResult>;
  status(request: { requestId: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
  cancel(request: { requestId: string; reason?: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
  fetchEvidence(request: { requestId: string }): ReturnType<typeof createUnsupportedConnectorOperationResult>;
}

interface NormalizedAllowedRoot {
  alias: string;
  path: string;
}

interface ResolvedLocalFileRequest {
  file: LocalFileRequest;
  sanitizedPath: string;
  absolutePath: string;
}

const defaultStatusReason = "local file connector completes fixture file actions inline";
const defaultCancelReason = "local file connector does not support cancellation";
const defaultEvidenceReason = "local file connector returns sanitized evidence from submit only";
const stableAliasPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const credentialValuePattern = /(authorization|cookie|password|secret|token|api[-_]?key)/i;

export const createInMemoryLocalFileIdempotencyStore = (): LocalFileIdempotencyStore => {
  const records = new Map<string, LocalFileIdempotencyRecord>();
  const pending = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<LocalFileIdempotencyStoreResult>;
    }
  >();

  return {
    async submitSuccessfulReceipt(input) {
      const existing = records.get(input.idempotencyKey);
      if (existing !== undefined) {
        return existing.fingerprint === input.fingerprint
          ? { status: "replayed", record: existing }
          : { status: "conflict" };
      }

      const inFlight = pending.get(input.idempotencyKey);
      if (inFlight !== undefined) {
        if (inFlight.fingerprint !== input.fingerprint) {
          return { status: "conflict" };
        }

        const result = await inFlight.promise;
        return result.status === "conflict"
          ? result
          : { status: "replayed", record: result.record };
      }

      const promise = (async (): Promise<LocalFileIdempotencyStoreResult> => {
        const receipt = await input.createReceipt();
        const record: LocalFileIdempotencyRecord = {
          receipt,
          fingerprint: input.fingerprint
        };
        records.set(input.idempotencyKey, record);
        return { status: "stored", record };
      })();

      pending.set(input.idempotencyKey, {
        fingerprint: input.fingerprint,
        promise
      });

      try {
        return await promise;
      } finally {
        const current = pending.get(input.idempotencyKey);
        if (current?.promise === promise) {
          pending.delete(input.idempotencyKey);
        }
      }
    }
  };
};

export const createLocalFileConnector = (
  input: CreateLocalFileConnectorInput
): LocalFileConnector => {
  const connectorId = input.connectorId ?? "local-file";
  const now = input.now ?? (() => new Date().toISOString());
  const allowedRoots = normalizeAllowedRoots(input.allowedRoots);
  const idempotencyStore = input.idempotencyStore ?? createInMemoryLocalFileIdempotencyStore();
  const capabilities: ConnectorCapabilities = {
    submit: { supported: true },
    status: { supported: false, reason: defaultStatusReason },
    cancel: { supported: false, reason: defaultCancelReason },
    fetchEvidence: { supported: false, reason: defaultEvidenceReason }
  };

  return {
    identity: {
      id: connectorId,
      displayName: "Local File Connector",
      version: "flow.local-file.v1"
    },
    capabilities,
    async submit(request: LocalFileSubmitRequest): Promise<LocalFileSubmitResult> {
      const validationError = validateSubmitRequest(request);
      if (validationError !== undefined) {
        return invalidRequest(connectorId, validationError);
      }

      const resolved = await resolveLocalFileRequest(request.file, allowedRoots);
      if (typeof resolved === "string") {
        return invalidRequest(connectorId, resolved);
      }

      const fingerprint = fingerprintFileRequest(request, resolved.sanitizedPath);
      let storedReceipt: LocalFileIdempotencyStoreResult;
      try {
        storedReceipt = await idempotencyStore.submitSuccessfulReceipt({
          idempotencyKey: request.idempotencyKey,
          fingerprint,
          createReceipt: async () => createLocalFileReceipt({
            connectorId,
            now,
            request,
            resolved
          })
        });
      } catch (error) {
        if (isLocalFileInvalidRequestError(error)) {
          return invalidRequest(connectorId, error.message);
        }

        if (!isLocalFileExecutionError(error)) {
          throw error;
        }

        return {
          ok: false,
          connectorId,
          operation: "submit",
          error: {
            code: "execution-failed",
            message: error.message,
            retryable: error.retryable
          }
        };
      }

      if (storedReceipt.status === "conflict") {
        return invalidRequest(
          connectorId,
          "local file idempotencyKey reuse must keep workflowId/runId/stepId/action/rootAlias/path/content unchanged"
        );
      }

      return {
        ok: true,
        connectorId,
        operation: "submit",
        value: storedReceipt.record.receipt
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

const createLocalFileReceipt = async (input: {
  connectorId: string;
  now: () => string;
  request: LocalFileSubmitRequest;
  resolved: ResolvedLocalFileRequest;
}): Promise<LocalFileReceipt> => {
  const unsafeContent = validateLocalFileContent(input.request);
  if (unsafeContent !== undefined) {
    throw new LocalFileInvalidRequestError(unsafeContent);
  }

  const outcome = await executeFileRequest(input.resolved);
  if (!outcome.ok) {
    throw new LocalFileExecutionError(outcome.message, outcome.retryable);
  }
  if (outcome.content !== undefined) {
    const unsafeOutput = findUnsafeWorkflowArtifactValue(
      outcome.content,
      "local file output"
    );
    if (unsafeOutput !== undefined) {
      throw new LocalFileExecutionError(
        formatUnsafeWorkflowArtifactDiagnostic(unsafeOutput),
        false
      );
    }
  }

  const requestId = `${input.connectorId}-${input.request.runId}-${input.request.stepId}`;
  const acceptedAt = input.now();
  const summary =
    input.resolved.file.action === "read"
      ? "local fixture file read"
      : "local fixture file written";

  return {
    requestId,
    acceptedAt,
    file: {
      action: input.resolved.file.action,
      rootAlias: input.resolved.file.rootAlias,
      path: input.resolved.sanitizedPath,
      bytes: outcome.bytes,
      summary
    },
    ...(outcome.content === undefined ? {} : { output: { content: outcome.content } }),
    evidence: {
      kind: "local-file-fixture",
      rootAlias: input.resolved.file.rootAlias,
      path: input.resolved.sanitizedPath,
      bytes: outcome.bytes
    }
  };
};

const normalizeAllowedRoots = (
  allowedRoots: LocalFileAllowedRoot[]
): Map<string, NormalizedAllowedRoot> => {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error("local file connector requires at least one allowed root");
  }

  const normalized = new Map<string, NormalizedAllowedRoot>();
  for (const root of allowedRoots) {
    if (!isRecord(root)) {
      throw new Error("local file allowed root must be an object");
    }

    if (typeof root.alias !== "string" || !stableAliasPattern.test(root.alias)) {
      throw new Error("local file allowed root alias must be stable kebab-case");
    }

    if (normalized.has(root.alias)) {
      throw new Error(`local file allowed root alias ${root.alias} must be unique`);
    }

    if (typeof root.path !== "string" || root.path.trim() === "") {
      throw new Error("local file allowed root path must be a non-empty absolute path");
    }

    if (!isAbsolute(root.path)) {
      throw new Error("local file allowed root path must be absolute");
    }

    if (credentialValuePattern.test(root.path)) {
      throw new Error("local file allowed root path must not contain credential-shaped segments");
    }

    const rootPath = resolve(root.path);
    if (rootPath === parse(rootPath).root) {
      throw new Error("local file allowed root path must not be a filesystem root");
    }

    normalized.set(root.alias, { alias: root.alias, path: rootPath });
  }

  return normalized;
};

const validateSubmitRequest = (request: LocalFileSubmitRequest): string | undefined => {
  if (typeof request.workflowId !== "string" || request.workflowId.trim().length === 0) {
    return "local file workflowId must be a non-empty string";
  }

  if (typeof request.runId !== "string" || request.runId.trim().length === 0) {
    return "local file runId must be a non-empty string";
  }

  if (typeof request.stepId !== "string" || request.stepId.trim().length === 0) {
    return "local file stepId must be a non-empty string";
  }

  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.trim().length === 0) {
    return "local file idempotencyKey must be a non-empty string";
  }

  if (!isRecord(request.file)) {
    return "local file request must include a file object";
  }

  if (request.file.action !== "read" && request.file.action !== "write") {
    return "local file action must be read or write";
  }

  if (typeof request.file.rootAlias !== "string" || !stableAliasPattern.test(request.file.rootAlias)) {
    return "local file rootAlias must be a configured stable alias";
  }

  if (typeof request.file.path !== "string" || request.file.path.trim() === "") {
    return "local file path must be a non-empty relative path";
  }

  if (request.file.action === "write" && typeof request.file.content !== "string") {
    return "local file write content must be a string";
  }

  if (request.file.action === "read" && request.file.content !== undefined) {
    return "local file read request must not include content";
  }

  return undefined;
};

const validateLocalFileContent = (request: LocalFileSubmitRequest): string | undefined => {
  if (request.file.content === undefined) {
    return undefined;
  }

  const unsafeContent = findUnsafeWorkflowArtifactValue(
    request.file.content,
    "local file content"
  );
  return unsafeContent === undefined
    ? undefined
    : formatUnsafeWorkflowArtifactDiagnostic(unsafeContent);
};

const resolveLocalFileRequest = async (
  file: LocalFileRequest,
  allowedRoots: Map<string, NormalizedAllowedRoot>
): Promise<ResolvedLocalFileRequest | string> => {
  const root = allowedRoots.get(file.rootAlias);
  if (root === undefined) {
    return "local file rootAlias is not configured";
  }

  if (file.path.includes("\\") || isAbsolute(file.path)) {
    return "local file path must be relative to an allowed root";
  }

  const normalizedRelativePath = normalize(file.path);
  if (
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith(`..${sep}`)
  ) {
    return "local file path must stay under the allowed root";
  }

  const absolutePath = resolve(root.path, normalizedRelativePath);
  const relativeToRoot = relative(root.path, absolutePath);
  if (
    relativeToRoot === "" ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) {
    return "local file path must stay under the allowed root";
  }

  const symlinkTraversalError = await validateNoSymbolicLinkTraversal(
    root.path,
    relativeToRoot
  );
  if (symlinkTraversalError !== undefined) {
    return symlinkTraversalError;
  }

  return {
    file,
    sanitizedPath: relativeToRoot.split(sep).join("/"),
    absolutePath
  };
};

const validateNoSymbolicLinkTraversal = async (
  rootPath: string,
  relativePath: string
): Promise<string | undefined> => {
  const rootState = await readPathState(rootPath);
  if (rootState === "symbolic-link" || rootState === "blocked") {
    return "local file path must stay under the allowed root";
  }

  let currentPath = rootPath;
  for (const segment of relativePath.split(sep)) {
    currentPath = resolve(currentPath, segment);
    const state = await readPathState(currentPath);
    if (state === "missing") {
      return undefined;
    }

    if (state === "symbolic-link" || state === "blocked") {
      return "local file path must stay under the allowed root";
    }
  }

  return undefined;
};

const readPathState = async (
  path: string
): Promise<"regular" | "symbolic-link" | "missing" | "blocked"> => {
  try {
    const stats = await lstat(path);
    return stats.isSymbolicLink() ? "symbolic-link" : "regular";
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT" ? "missing" : "blocked";
  }
};

const executeFileRequest = async (
  request: ResolvedLocalFileRequest
): Promise<
  | { ok: true; bytes: number; content?: string }
  | { ok: false; message: string; retryable: boolean }
> => {
  if (request.file.action === "read") {
    try {
      const content = await readFile(request.absolutePath, "utf8");
      return { ok: true, bytes: Buffer.byteLength(content, "utf8"), content };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {
          ok: false,
          message: "local file read target was not found",
          retryable: true
        };
      }

      return {
        ok: false,
        message: "local file read failed",
        retryable: false
      };
    }
  }

  try {
    await mkdir(dirname(request.absolutePath), { recursive: true });
    await writeFile(request.absolutePath, request.file.content ?? "", "utf8");
    return {
      ok: true,
      bytes: Buffer.byteLength(request.file.content ?? "", "utf8")
    };
  } catch {
    return {
      ok: false,
      message: "local file write failed",
      retryable: false
    };
  }
};

const invalidRequest = (
  connectorId: string,
  message: string
): LocalFileSubmitResult => ({
  ok: false,
  connectorId,
  operation: "submit",
  error: {
    code: "invalid-request",
    message,
    retryable: false
  }
});

class LocalFileExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "LocalFileExecutionError";
    this.retryable = retryable;
  }
}

const isLocalFileExecutionError = (error: unknown): error is LocalFileExecutionError =>
  error instanceof LocalFileExecutionError;

class LocalFileInvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalFileInvalidRequestError";
  }
}

const isLocalFileInvalidRequestError = (error: unknown): error is LocalFileInvalidRequestError =>
  error instanceof LocalFileInvalidRequestError;

const fingerprintFileRequest = (
  request: LocalFileSubmitRequest,
  sanitizedPath: string
): string =>
  stableStringify({
    workflowId: request.workflowId,
    runId: request.runId,
    stepId: request.stepId,
    action: request.file.action,
    rootAlias: request.file.rootAlias,
    path: sanitizedPath,
    content: request.file.content ?? null
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
