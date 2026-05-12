import type { WorkflowDefinition } from "./workflow-definition.js";

export type CustomerWorkflowAllowlistMode =
  | "fake"
  | "read-only"
  | "draft-only"
  | "live-write-back";

export interface CustomerWorkflowAllowlistPolicy {
  schemaVersion: "flow.customer-workflow-allowlist.v1";
  entries: CustomerWorkflowAllowlistEntry[];
}

export interface CustomerWorkflowAllowlistEntry {
  customerWorkflowRef: string;
  modes: CustomerWorkflowAllowlistMode[];
  erpNext?: CustomerWorkflowErpNextAllowlist;
}

export interface CustomerWorkflowErpNextAllowlist {
  siteRefs?: string[];
  objectTypes?: string[];
  endpointRefs?: string[];
}

export interface CustomerWorkflowInput {
  ref: string;
  mode: CustomerWorkflowAllowlistMode;
  erpNext?: CustomerWorkflowErpNextReference;
}

export interface CustomerWorkflowErpNextReference {
  siteRef?: string;
  objectType?: string;
  endpointRef?: string;
}

const CUSTOMER_WORKFLOW_ALLOWLIST_SCHEMA_VERSION =
  "flow.customer-workflow-allowlist.v1";

const CUSTOMER_WORKFLOW_MODES = new Set<CustomerWorkflowAllowlistMode>([
  "fake",
  "read-only",
  "draft-only",
  "live-write-back"
]);

export const assertCustomerWorkflowAllowlisted = (input: {
  definition: WorkflowDefinition;
  triggerContext: Record<string, unknown>;
}): void => {
  const customerWorkflow = input.triggerContext.customerWorkflow;
  if (customerWorkflow === undefined) {
    return;
  }

  if (!isCustomerWorkflowInput(customerWorkflow)) {
    throw new Error("customer workflow input is malformed; diagnostic redacted");
  }

  if (customerWorkflow.mode === "live-write-back") {
    throw new Error(
      "customer workflow input requested live-write-back mode; ERPNext live write-back remains disabled; diagnostic redacted"
    );
  }

  const policy = resolveCustomerWorkflowAllowlistPolicy(input.definition);
  const policyEntry = policy?.entries.find(
    (entry) =>
      entry.customerWorkflowRef === customerWorkflow.ref &&
      entry.modes.includes(customerWorkflow.mode)
  );

  if (policyEntry === undefined) {
    throw new Error(
      `customer workflow input is not allowlisted for mode ${customerWorkflow.mode}; diagnostic redacted`
    );
  }

  if (
    customerWorkflow.erpNext !== undefined &&
    !erpNextReferenceMatchesPolicy(customerWorkflow.erpNext, policyEntry.erpNext)
  ) {
    throw new Error(
      `ERPNext reference is not allowlisted for mode ${customerWorkflow.mode}; diagnostic redacted`
    );
  }
};

const resolveCustomerWorkflowAllowlistPolicy = (
  definition: WorkflowDefinition
): CustomerWorkflowAllowlistPolicy | undefined => {
  const policy = definition.metadata?.customerWorkflowAllowlist;
  if (!isRecord(policy)) {
    return undefined;
  }

  if (policy.schemaVersion !== CUSTOMER_WORKFLOW_ALLOWLIST_SCHEMA_VERSION) {
    return undefined;
  }

  if (!Array.isArray(policy.entries)) {
    return undefined;
  }

  const entries = policy.entries.filter(isCustomerWorkflowAllowlistEntry);
  if (entries.length !== policy.entries.length) {
    return undefined;
  }

  return {
    schemaVersion: CUSTOMER_WORKFLOW_ALLOWLIST_SCHEMA_VERSION,
    entries
  };
};

const isCustomerWorkflowAllowlistEntry = (
  value: unknown
): value is CustomerWorkflowAllowlistEntry => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.customerWorkflowRef) &&
    Array.isArray(value.modes) &&
    value.modes.length > 0 &&
    value.modes.every(isCustomerWorkflowAllowlistMode) &&
    (value.erpNext === undefined || isCustomerWorkflowErpNextAllowlist(value.erpNext))
  );
};

const isCustomerWorkflowErpNextAllowlist = (
  value: unknown
): value is CustomerWorkflowErpNextAllowlist =>
  isRecord(value) &&
  optionalStringList(value.siteRefs) &&
  optionalStringList(value.objectTypes) &&
  optionalStringList(value.endpointRefs);

const isCustomerWorkflowInput = (value: unknown): value is CustomerWorkflowInput => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.ref) &&
    isCustomerWorkflowAllowlistMode(value.mode) &&
    (value.erpNext === undefined || isCustomerWorkflowErpNextReference(value.erpNext))
  );
};

const isCustomerWorkflowErpNextReference = (
  value: unknown
): value is CustomerWorkflowErpNextReference =>
  isRecord(value) &&
  optionalString(value.siteRef) &&
  optionalString(value.objectType) &&
  optionalString(value.endpointRef);

const erpNextReferenceMatchesPolicy = (
  reference: CustomerWorkflowErpNextReference,
  allowlist: CustomerWorkflowErpNextAllowlist | undefined
): boolean => {
  if (allowlist === undefined) {
    return false;
  }

  return (
    stringFieldMatches(reference.siteRef, allowlist.siteRefs) &&
    stringFieldMatches(reference.objectType, allowlist.objectTypes) &&
    stringFieldMatches(reference.endpointRef, allowlist.endpointRefs)
  );
};

const stringFieldMatches = (
  referenceValue: string | undefined,
  allowedValues: string[] | undefined
): boolean => {
  if (referenceValue === undefined) {
    return true;
  }

  return allowedValues?.includes(referenceValue) ?? false;
};

const isCustomerWorkflowAllowlistMode = (
  value: unknown
): value is CustomerWorkflowAllowlistMode =>
  typeof value === "string" && CUSTOMER_WORKFLOW_MODES.has(value as CustomerWorkflowAllowlistMode);

const optionalStringList = (value: unknown): value is string[] | undefined =>
  value === undefined || (Array.isArray(value) && value.every(isNonEmptyString));

const optionalString = (value: unknown): value is string | undefined =>
  value === undefined || isNonEmptyString(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
