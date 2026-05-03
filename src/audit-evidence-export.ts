import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readWorkflowRunState } from "./workflow-run-state.js";
import type {
  WorkflowRunState,
  WorkflowStepAttemptEvent
} from "./workflow-run-state.js";
import type { NeutralAuditEvent } from "./audit-event-writer.js";

export interface CreateAuditEvidenceExportInput {
  statePath: string;
  auditPath?: string;
  outputPath?: string;
}

export interface AuditEvidenceExport {
  schemaVersion: "flow.audit-evidence-export.v1";
  boundary: AuditEvidenceExportBoundary;
  publicSafe: AuditEvidenceExportPublicSafe;
  localConfidentialReferences: AuditEvidenceExportLocalConfidentialReferences;
}

export interface AuditEvidenceExportBoundary {
  productionEvidenceReady: false;
  protocolSnapshot: {
    name: "ensen-protocol";
    version: "0.2.0";
  };
  protocolEvidenceProfile: "pending-protocol-phase-4";
  notes: string[];
}

export interface AuditEvidenceExportPublicSafe {
  run: {
    runId: string;
    workflowId: string;
    workflowVersion: string;
    status: string;
    terminalState?: string;
    createdAt: string;
    updatedAt: string;
  };
  trigger: {
    type: string;
    receivedAt: string;
    contextExported: false;
    idempotencyKey?: {
      source: string;
      keyExported: false;
    };
  };
  steps: AuditEvidenceExportStepSummary[];
  auditEvents: AuditEvidenceExportAuditEventSummary[];
  evidenceRefs: AuditEvidenceExportEvidenceRef[];
  diagnostics: string[];
}

export interface AuditEvidenceExportStepSummary {
  stepId: string;
  attempts: Array<{
    attempt: number;
    status: string;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
    retryable?: boolean;
  }>;
}

export interface AuditEvidenceExportAuditEventSummary {
  id: string;
  type: string;
  occurredAt: string;
  workflowId: string;
  runId: string;
  stepId?: string;
  attempt?: number;
  outcomeStatus?: string;
}

export interface AuditEvidenceExportEvidenceRef {
  schemaVersion: "eip.evidence-bundle-ref.v1";
  id: string;
  correlationId: string;
  type: "local_path" | "file_uri";
  uri: string;
  createdAt: string;
  contentType?: string;
  checksum?: {
    algorithm: "sha256";
    value: string;
  };
}

export interface AuditEvidenceExportLocalConfidentialReferences {
  statePath: AuditEvidenceExportLocalReference;
  auditPath?: AuditEvidenceExportLocalReference;
  outputPath?: AuditEvidenceExportLocalReference;
}

export interface AuditEvidenceExportLocalReference {
  classification: "local-confidential-reference";
  value: string;
}

const EXPORT_SCHEMA_VERSION = "flow.audit-evidence-export.v1";
const EVIDENCE_REF_SCHEMA_VERSION = "eip.evidence-bundle-ref.v1";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const createAuditEvidenceExport = async (
  input: CreateAuditEvidenceExportInput
): Promise<AuditEvidenceExport> => {
  const state = await readWorkflowRunState(input.statePath);
  const diagnostics: string[] = [];
  const auditEvents =
    input.auditPath === undefined
      ? []
      : await readNeutralAuditEvents(input.auditPath).catch((error: unknown) => {
          throw new Error(`audit event export failed: ${safeErrorMessage(error)}`);
        });
  const exportArtifact: AuditEvidenceExport = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    boundary: {
      productionEvidenceReady: false,
      protocolSnapshot: {
        name: "ensen-protocol",
        version: "0.2.0"
      },
      protocolEvidenceProfile: "pending-protocol-phase-4",
      notes: [
        "This is a deterministic local metadata export skeleton.",
        "It is not a production evidence archive, compliance bundle, or customer data export.",
        "Protocol Phase 4 evidence profile fields are not fabricated before a protocol snapshot exists."
      ]
    },
    publicSafe: {
      run: {
        runId: state.run.runId,
        workflowId: state.run.workflowId,
        workflowVersion: state.run.workflowVersion,
        status: state.run.status,
        ...(state.run.terminalState === undefined
          ? {}
          : { terminalState: state.run.terminalState }),
        createdAt: state.run.createdAt,
        updatedAt: state.run.updatedAt
      },
      trigger: {
        type: state.run.trigger.type,
        receivedAt: state.run.trigger.receivedAt,
        contextExported: false,
        ...(state.run.trigger.idempotencyKey === undefined
          ? {}
          : {
              idempotencyKey: {
                source: state.run.trigger.idempotencyKey.source,
                keyExported: false
              }
            })
      },
      steps: summarizeStepAttempts(state),
      auditEvents: auditEvents.map(summarizeAuditEvent),
      evidenceRefs: collectPublicEvidenceRefs(state, diagnostics),
      diagnostics
    },
    localConfidentialReferences: {
      statePath: {
        classification: "local-confidential-reference",
        value: "<local-workflow-run-state-jsonl>"
      },
      ...(input.auditPath === undefined
        ? {}
        : {
            auditPath: {
              classification: "local-confidential-reference",
              value: "<local-audit-jsonl>"
            }
          }),
      ...(input.outputPath === undefined
        ? {}
        : {
            outputPath: {
              classification: "local-confidential-reference",
              value: "<local-export-json>"
            }
          })
    }
  };

  if (input.outputPath !== undefined) {
    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, `${JSON.stringify(exportArtifact, null, 2)}\n`, "utf8");
  }

  return exportArtifact;
};

const summarizeStepAttempts = (
  state: WorkflowRunState
): AuditEvidenceExportStepSummary[] =>
  Object.entries(state.stepAttempts).map(([stepId, attempts]) => ({
    stepId,
    attempts: attempts.map((attempt) => ({
      attempt: attempt.attempt,
      status: attempt.status,
      ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
      ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
      ...(attempt.failedAt === undefined ? {} : { failedAt: attempt.failedAt }),
      ...(attempt.retry === undefined ? {} : { retryable: attempt.retry.retryable })
    }))
  }));

const readNeutralAuditEvents = async (auditPath: string): Promise<NeutralAuditEvent[]> => {
  const contents = await readFile(auditPath, "utf8");
  const lines = contents.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.map((line, index) => {
    if (line.trim() === "") {
      throw new Error(`audit JSONL line ${index + 1}: record must not be blank`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`audit JSONL line ${index + 1}: invalid JSON`);
    }

    if (!isRecord(parsed)) {
      throw new Error(`audit JSONL line ${index + 1}: record must be an object`);
    }

    return validateNeutralAuditEventForExport(parsed, index + 1);
  });
};

const validateNeutralAuditEventForExport = (
  value: Record<string, unknown>,
  lineNumber: number
): NeutralAuditEvent => {
  if (
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.occurredAt !== "string" ||
    !isRecord(value.workflow) ||
    typeof value.workflow.id !== "string" ||
    !isRecord(value.run) ||
    typeof value.run.id !== "string"
  ) {
    throw new Error(`audit JSONL line ${lineNumber}: record is outside the audit export boundary`);
  }

  return value as unknown as NeutralAuditEvent;
};

const summarizeAuditEvent = (
  event: NeutralAuditEvent
): AuditEvidenceExportAuditEventSummary => ({
  id: event.id,
  type: event.type,
  occurredAt: event.occurredAt,
  workflowId: event.workflow.id,
  runId: event.run.id,
  ...(event.step === undefined
    ? {}
    : {
        stepId: event.step.id,
        attempt: event.step.attempt
      }),
  ...(event.outcome === undefined ? {} : { outcomeStatus: event.outcome.status })
});

const collectPublicEvidenceRefs = (
  state: WorkflowRunState,
  diagnostics: string[]
): AuditEvidenceExportEvidenceRef[] => {
  const refs: AuditEvidenceExportEvidenceRef[] = [];

  for (const event of state.events) {
    if (!isStepTerminalEvent(event) || event.result === undefined) {
      continue;
    }

    collectEvidenceRefsFromValue(event.result, refs, diagnostics);
  }

  return refs;
};

const collectEvidenceRefsFromValue = (
  value: unknown,
  refs: AuditEvidenceExportEvidenceRef[],
  diagnostics: string[]
): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceRefsFromValue(item, refs, diagnostics));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const evidenceRef = normalizeEvidenceRef(value);
  if (evidenceRef !== undefined) {
    if (isPublicSafeEvidenceRef(evidenceRef)) {
      refs.push(evidenceRef);
    } else {
      diagnostics.push("omitted an evidence reference because its URI is not public-safe");
    }
    return;
  }

  for (const nestedValue of Object.values(value)) {
    collectEvidenceRefsFromValue(nestedValue, refs, diagnostics);
  }
};

const normalizeEvidenceRef = (
  value: Record<string, unknown>
): AuditEvidenceExportEvidenceRef | undefined => {
  if (value.schemaVersion !== EVIDENCE_REF_SCHEMA_VERSION) {
    return undefined;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.correlationId !== "string" ||
    (value.type !== "local_path" && value.type !== "file_uri") ||
    typeof value.uri !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }

  const checksum = normalizeChecksum(value.checksum);
  return {
    schemaVersion: EVIDENCE_REF_SCHEMA_VERSION,
    id: value.id,
    correlationId: value.correlationId,
    type: value.type,
    uri: value.uri,
    createdAt: value.createdAt,
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    ...(checksum === undefined ? {} : { checksum })
  };
};

const normalizeChecksum = (
  value: unknown
): AuditEvidenceExportEvidenceRef["checksum"] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.algorithm !== "sha256" || typeof value.value !== "string") {
    return undefined;
  }

  if (!SHA256_HEX_PATTERN.test(value.value)) {
    return undefined;
  }

  return {
    algorithm: "sha256",
    value: value.value
  };
};

const isPublicSafeEvidenceRef = (ref: AuditEvidenceExportEvidenceRef): boolean => {
  if (containsCredentialShape(ref.uri) || containsWorkstationLocalPath(ref.uri)) {
    return false;
  }

  if (ref.type === "local_path") {
    return isSafeRelativePath(ref.uri);
  }

  return isSafeFileUri(ref.uri);
};

const isSafeRelativePath = (value: string): boolean =>
  value.trim() !== "" &&
  !value.startsWith("/") &&
  !value.startsWith("\\") &&
  !value.includes("://") &&
  !value.split(/[\\/]+/u).includes("..");

const isSafeFileUri = (value: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "file:" || parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    return false;
  }

  return (
    !parsed.pathname.split("/").includes("..") &&
    !containsWorkstationLocalPath(parsed.pathname)
  );
};

const containsCredentialShape = (value: string): boolean =>
  /(?:token|secret|password|passwd|apikey|api_key|access_key)=/iu.test(value) ||
  /:\/\/[^/\s:@]+:[^/\s@]+@/u.test(value);

const containsWorkstationLocalPath = (value: string): boolean =>
  /(^|[/\\])Users[/\\][^/\\]+/u.test(value) ||
  /(^|[/\\])home[/\\][^/\\]+/u.test(value) ||
  /^[A-Za-z]:[/\\]Users[/\\][^/\\]+/u.test(value);

const isStepTerminalEvent = (event: unknown): event is WorkflowStepAttemptEvent =>
  isRecord(event) &&
  (event.type === "step.attempt.completed" || event.type === "step.attempt.failed");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/(?:\/Users|\/home|[A-Za-z]:\\Users)[^\s'"]*/gu, "<local-path>");
};
