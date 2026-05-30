import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readWorkflowRunState } from "./workflow-run-state.js";
import type {
  WorkflowRunState,
  WorkflowStepAttemptEvent
} from "./workflow-run-state.js";
import type { NeutralAuditEvent } from "./audit-event-writer.js";
import { classifyUnsafeWorkflowArtifactString } from "./workflow-artifact-hygiene.js";

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
    version: "0.4.0";
  };
  protocolEvidenceProfileSnapshot: {
    name: "ensen-protocol";
    version: "0.3.0";
    profile: "operational-evidence-profile.v1";
  };
  trackBBoundarySnapshot: {
    name: "ensen-protocol";
    version: "0.4.0";
    boundary: "Track B customer-regulated data classification";
  };
  protocolEvidenceProfile: "operational-evidence-profile.v1";
  notes: string[];
}

export interface AuditEvidenceExportPublicSafe {
  profile: AuditEvidenceExportPublicSafeProfile;
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
  recoveryReplay: AuditEvidenceExportRecoveryReplay;
  diagnostics: string[];
}

export interface AuditEvidenceExportPublicSafeProfile {
  dataClassification: "public";
  producerMetadata: {
    producer: "ensen-flow";
    producerVersion: "flow.audit-evidence-export.v1";
    protocolVersion: "0.4.0";
    command: "export-audit-evidence";
    boundary: "local-audit-evidence-export";
    createdBy: "ensen-flow";
  };
  retentionHint: "localEphemeral";
  confidentialReferencePolicy: {
    allowedInPublicSafe: false;
    localConfidentialReferenceValuesExported: false;
    guidance: string;
  };
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
  dataClassification: "public";
  referenceKind: "publicSafeArtifactReference";
  checksumPresence: "present" | "absent";
}

export interface AuditEvidenceExportRecoveryReplay {
  source: "workflow-run-state-and-neutral-audit";
  run: {
    status: string;
    terminalState?: string;
    recoveryClassification:
      | "recoverable"
      | "terminal"
      | "approval-required"
      | "blocked"
      | "manual-repair-needed";
    replayAction:
      | "resume-from-projected-state"
      | "do-not-replay"
      | "operator-review-required";
  };
  trigger: {
    idempotencyKeyBound: boolean;
    keyExported: false;
  };
  stepHistory: AuditEvidenceExportRecoveryReplayStep[];
}

export interface AuditEvidenceExportRecoveryReplayStep {
  stepId: string;
  attempt: number;
  status: string;
  auditEventIds: string[];
  retry?: {
    retryable: boolean;
    nextAttemptAt?: string;
    reasonExported: false;
  };
  recovery?: {
    state: string;
    decision: string;
    reasonExported: false;
  };
  approval?: {
    state: AuditEvidenceExportApprovalState;
    inputRef?: string;
    decidedAt?: string;
    reasonExported: false;
    decidedByExported: false;
  };
  evidenceRefIds: string[];
}

type EvidenceDataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "customer-confidential"
  | "regulated"
  | "restricted";
export type AuditEvidenceExportApprovalState = "approval-required" | "approved" | "rejected";

type NormalizedEvidenceRef = Omit<
  AuditEvidenceExportEvidenceRef,
  "dataClassification" | "referenceKind"
> & {
  dataClassification: EvidenceDataClassification | undefined;
  referenceKind: "publicSafeArtifactReference" | "localConfidentialReference";
};

interface AuditEvidenceExportRunScope {
  runId: string;
  workflowId: string;
  workflowVersion: string;
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
const ISO_UTC_MILLIS_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EXPORTABLE_APPROVAL_STATES = new Set<AuditEvidenceExportApprovalState>([
  "approval-required",
  "approved",
  "rejected"
]);

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
  const runAuditEvents = filterAuditEventsForRun(state, auditEvents);
  const exportArtifact: AuditEvidenceExport = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    boundary: {
      productionEvidenceReady: false,
      protocolSnapshot: {
        name: "ensen-protocol",
        version: "0.4.0"
      },
      protocolEvidenceProfileSnapshot: {
        name: "ensen-protocol",
        version: "0.3.0",
        profile: "operational-evidence-profile.v1"
      },
      trackBBoundarySnapshot: {
        name: "ensen-protocol",
        version: "0.4.0",
        boundary: "Track B customer-regulated data classification"
      },
      protocolEvidenceProfile: "operational-evidence-profile.v1",
      notes: [
        "This is a deterministic local metadata export skeleton.",
        "It is not a production evidence archive, compliance bundle, or customer data export.",
        "It uses copied Protocol v0.3.0 operational evidence profile and Protocol v0.4.0 Track B boundary snapshots without runtime protocol imports, protocol conformance claims, regulated workflow execution, or production evidence readiness."
      ]
    },
    publicSafe: {
      profile: {
        dataClassification: "public",
        producerMetadata: {
          producer: "ensen-flow",
          producerVersion: EXPORT_SCHEMA_VERSION,
          protocolVersion: "0.4.0",
          command: "export-audit-evidence",
          boundary: "local-audit-evidence-export",
          createdBy: "ensen-flow"
        },
        retentionHint: "localEphemeral",
        confidentialReferencePolicy: {
          allowedInPublicSafe: false,
          localConfidentialReferenceValuesExported: false,
          guidance:
            "Local confidential reference values stay in localConfidentialReferences placeholders and are never emitted in publicSafe output."
        }
      },
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
      auditEvents: runAuditEvents.map(summarizeAuditEvent),
      evidenceRefs: collectPublicEvidenceRefs(state, diagnostics),
      recoveryReplay: createRecoveryReplaySummary(state, runAuditEvents),
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

const filterAuditEventsForRun = (
  state: WorkflowRunState,
  auditEvents: NeutralAuditEvent[]
): NeutralAuditEvent[] =>
  auditEvents.filter(
    (event) =>
      event.run.id === state.run.runId &&
      event.workflow.id === state.run.workflowId &&
      event.workflow.version === state.run.workflowVersion
  );

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
  const boundaryMessage = `audit JSONL line ${lineNumber}: record is outside the audit export boundary`;

  if (
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.occurredAt !== "string" ||
    !isRecord(value.workflow) ||
    typeof value.workflow.id !== "string" ||
    typeof value.workflow.version !== "string" ||
    !isRecord(value.run) ||
    typeof value.run.id !== "string"
  ) {
    throw new Error(boundaryMessage);
  }

  if (
    value.step !== undefined &&
    (!isRecord(value.step) ||
      typeof value.step.id !== "string" ||
      typeof value.step.attempt !== "number")
  ) {
    throw new Error(boundaryMessage);
  }

  if (
    value.outcome !== undefined &&
    (!isRecord(value.outcome) || typeof value.outcome.status !== "string")
  ) {
    throw new Error(boundaryMessage);
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

const createRecoveryReplaySummary = (
  state: WorkflowRunState,
  auditEvents: NeutralAuditEvent[]
): AuditEvidenceExportRecoveryReplay => {
  const recoveryClassification = classifyRecoveryReplay(state);
  const runScope: AuditEvidenceExportRunScope = {
    runId: state.run.runId,
    workflowId: state.run.workflowId,
    workflowVersion: state.run.workflowVersion
  };

  return {
    source: "workflow-run-state-and-neutral-audit",
    run: {
      status: state.run.status,
      ...(state.run.terminalState === undefined
        ? {}
        : { terminalState: state.run.terminalState }),
      recoveryClassification,
      replayAction: recoveryReplayAction(recoveryClassification)
    },
    trigger: {
      idempotencyKeyBound: state.run.trigger.idempotencyKey !== undefined,
      keyExported: false
    },
    stepHistory: Object.entries(state.stepAttempts).flatMap(([stepId, attempts]) =>
      attempts.map((attempt) =>
        summarizeRecoveryReplayStep(runScope, stepId, attempt, auditEvents)
      )
    )
  };
};

const summarizeRecoveryReplayStep = (
  runScope: AuditEvidenceExportRunScope,
  stepId: string,
  attempt: WorkflowStepAttemptEventSummary,
  auditEvents: NeutralAuditEvent[]
): AuditEvidenceExportRecoveryReplayStep => {
  const approval = approvalSummaryFromAttempt(attempt);
  const evidenceRefIds = evidenceRefIdsFromAttempt(attempt);

  return {
    stepId,
    attempt: attempt.attempt,
    status: attempt.status,
    auditEventIds: auditEvents
      .filter(
        (event) =>
          event.run.id === runScope.runId &&
          event.workflow.id === runScope.workflowId &&
          event.workflow.version === runScope.workflowVersion &&
          event.step?.id === stepId &&
          event.step.attempt === attempt.attempt
      )
      .map((event) => event.id),
    ...(attempt.retry === undefined
      ? {}
      : {
          retry: {
            retryable: attempt.retry.retryable,
            ...(attempt.retry.nextAttemptAt === undefined
              ? {}
              : { nextAttemptAt: attempt.retry.nextAttemptAt }),
            reasonExported: false
          }
        }),
    ...(attempt.recovery === undefined
      ? {}
      : {
          recovery: {
            state: attempt.recovery.state,
            decision: attempt.recovery.decision,
            reasonExported: false
          }
        }),
    ...(approval === undefined ? {} : { approval }),
    evidenceRefIds
  };
};

type WorkflowStepAttemptEventSummary = WorkflowRunState["stepAttempts"][string][number];

const approvalSummaryFromAttempt = (
  attempt: WorkflowStepAttemptEventSummary
): AuditEvidenceExportRecoveryReplayStep["approval"] | undefined => {
  const approval = findApprovalCheckpoint(attempt.result);
  if (approval === undefined) {
    return undefined;
  }

  return {
    state: approval.state,
    ...(approval.inputRef === undefined ? {} : { inputRef: approval.inputRef }),
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
    reasonExported: false,
    decidedByExported: false
  };
};

const findApprovalCheckpoint = (
  value: unknown
):
  | { state: AuditEvidenceExportApprovalState; inputRef?: string; decidedAt?: string }
  | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findApprovalCheckpoint(item);
      if (nested !== undefined) {
        return nested;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (value.schemaVersion === "flow.approval-checkpoint.v1") {
    if (!isExportableApprovalState(value.state)) {
      return undefined;
    }

    return {
      state: value.state,
      ...approvalInputRefExport(value),
      ...(typeof value.decidedAt === "string" && isStrictUtcMillisTimestamp(value.decidedAt)
        ? { decidedAt: value.decidedAt }
        : {})
    };
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findApprovalCheckpoint(nestedValue);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
};

const approvalInputRefExport = (
  value: Record<string, unknown>
): { inputRef: string } | Record<string, never> => {
  if (
    typeof value.inputRef !== "string" ||
    value.inputRefDataClassification !== "public" ||
    !isPublicSafeRelativeRef(value.inputRef)
  ) {
    return {};
  }

  return { inputRef: value.inputRef };
};

const isExportableApprovalState = (
  value: unknown
): value is AuditEvidenceExportApprovalState =>
  typeof value === "string" &&
  EXPORTABLE_APPROVAL_STATES.has(value as AuditEvidenceExportApprovalState);

const isStrictUtcMillisTimestamp = (value: string): boolean => {
  if (!ISO_UTC_MILLIS_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const evidenceRefIdsFromAttempt = (attempt: WorkflowStepAttemptEventSummary): string[] => {
  if (attempt.result === undefined) {
    return [];
  }

  const refs: AuditEvidenceExportEvidenceRef[] = [];
  collectEvidenceRefsFromValue(attempt.result, refs, []);
  return refs.map((ref) => ref.id);
};

const classifyRecoveryReplay = (
  state: WorkflowRunState
): AuditEvidenceExportRecoveryReplay["run"]["recoveryClassification"] => {
  if (state.run.terminalState === "failed" && hasLatestStepStatus(state, "blocked")) {
    return "blocked";
  }

  if (state.run.terminalState !== undefined) {
    return "terminal";
  }

  if (hasLatestStepStatus(state, "running")) {
    return "manual-repair-needed";
  }

  if (hasLatestStepStatus(state, "approval-required")) {
    return "approval-required";
  }

  if (hasLatestStepStatus(state, "blocked")) {
    return "blocked";
  }

  if (hasLatestStepStatus(state, "failed")) {
    return "manual-repair-needed";
  }

  return "recoverable";
};

const recoveryReplayAction = (
  classification: AuditEvidenceExportRecoveryReplay["run"]["recoveryClassification"]
): AuditEvidenceExportRecoveryReplay["run"]["replayAction"] => {
  if (classification === "terminal") {
    return "do-not-replay";
  }

  if (classification === "recoverable") {
    return "resume-from-projected-state";
  }

  return "operator-review-required";
};

const hasLatestStepStatus = (
  state: WorkflowRunState,
  status: WorkflowStepAttemptEventSummary["status"]
): boolean =>
  Object.values(state.stepAttempts).some((attempts) => attempts.at(-1)?.status === status);

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
      diagnostics.push(createUnsafeEvidenceRefDiagnostic(evidenceRef));
    }
    return;
  }

  for (const nestedValue of Object.values(value)) {
    collectEvidenceRefsFromValue(nestedValue, refs, diagnostics);
  }
};

const normalizeEvidenceRef = (
  value: Record<string, unknown>
): NormalizedEvidenceRef | undefined => {
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
  const dataClassification = normalizeDataClassification(
    value.dataClassification,
    typeof value.id === "string" ? value.id : "<unknown-evidence-ref>"
  );
  return {
    schemaVersion: EVIDENCE_REF_SCHEMA_VERSION,
    id: value.id,
    correlationId: value.correlationId,
    type: value.type,
    uri: value.uri,
    createdAt: value.createdAt,
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    ...(checksum === undefined ? {} : { checksum }),
    dataClassification,
    referenceKind:
      dataClassification === "public"
        ? "publicSafeArtifactReference"
        : "localConfidentialReference",
    checksumPresence: checksum === undefined ? "absent" : "present"
  };
};

const normalizeDataClassification = (
  value: unknown,
  evidenceRefId: string
): EvidenceDataClassification | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === "public") {
    return "public";
  }

  if (
    value === "internal" ||
    value === "confidential" ||
    value === "customer-confidential" ||
    value === "regulated" ||
    value === "restricted"
  ) {
    return value;
  }

  throw new Error(
    `evidence ref ${safeErrorMessage(evidenceRefId)} has unsupported dataClassification ${formatUnknownEnumValue(value)}`
  );
};

const formatUnknownEnumValue = (value: unknown): string => {
  if (typeof value === "string") {
    return JSON.stringify(safeErrorMessage(value).slice(0, 64));
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
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

const isPublicSafeEvidenceRef = (
  ref: NormalizedEvidenceRef
): ref is AuditEvidenceExportEvidenceRef => {
  if (ref.dataClassification !== "public") {
    return false;
  }

  if (classifyUnsafeWorkflowArtifactString(ref.uri) !== undefined) {
    return false;
  }

  if (ref.type === "local_path") {
    return isSafeRelativePath(ref.uri);
  }

  return isPublicSafeFileUri(ref.uri);
};

const isSafeRelativePath = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    trimmed !== "" &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("\\") &&
    !isWindowsDriveAbsolutePath(trimmed) &&
    !trimmed.includes("://") &&
    !trimmed.split(/[\\/]+/u).includes("..")
  );
};

const isPublicSafeRelativeRef = (value: string): boolean =>
  isSafeRelativePath(value) && classifyUnsafeWorkflowArtifactString(value) === undefined;

const createUnsafeEvidenceRefDiagnostic = (ref: NormalizedEvidenceRef): string => {
  if (ref.dataClassification === undefined) {
    return "omitted an evidence reference because its data classification is missing";
  }

  if (ref.dataClassification !== "public") {
    return "omitted an evidence reference because its data classification is not public-safe";
  }

  const category = classifyUnsafeWorkflowArtifactString(ref.uri) ?? "non-public-uri";
  return `omitted an evidence reference because its URI is not public-safe (category: ${category})`;
};

const isPublicSafeFileUri = (_value: string): boolean =>
  // Flow has not adopted a public-safe file: URI mapping for local exports.
  false;

const isWindowsDriveAbsolutePath = (value: string): boolean =>
  /^[A-Za-z]:[/\\]/u.test(value);

const isStepTerminalEvent = (event: unknown): event is WorkflowStepAttemptEvent =>
  isRecord(event) &&
  (event.type === "step.attempt.completed" || event.type === "step.attempt.failed");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/(?:\/Users|\/home|[A-Za-z]:\\Users)[^\s'"]*/gu, "<local-path>");
};
