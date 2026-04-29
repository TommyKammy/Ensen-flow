const WORKFLOW_SCHEMA_VERSION = "flow.workflow.v1";

const TRIGGER_TYPES = new Set(["manual", "schedule", "webhook"]);
const ACTION_TYPES = new Set(["local", "approval", "notification"]);
const IDEMPOTENCY_KEY_SOURCES = new Set(["input", "workflow", "static"]);
const BACKOFF_STRATEGIES = new Set(["none", "fixed", "exponential"]);
const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TRIGGER_ALLOWED_KEYS = new Set(["type", "cron", "path", "idempotencyKey"]);
const MANUAL_TRIGGER_ALLOWED_KEYS = new Set(["type", "idempotencyKey"]);
const SCHEDULE_TRIGGER_ALLOWED_KEYS = new Set(["type", "cron", "idempotencyKey"]);
const WEBHOOK_TRIGGER_ALLOWED_KEYS = new Set(["type", "path", "idempotencyKey"]);
const ACTION_ALLOWED_KEYS = new Set(["type", "name", "with"]);
const RETRY_POLICY_ALLOWED_KEYS = new Set(["maxAttempts", "backoff"]);
const RETRY_BACKOFF_ALLOWED_KEYS = new Set([
  "strategy",
  "delayMs",
  "initialDelayMs",
  "maxDelayMs"
]);
const RETRY_BACKOFF_NONE_ALLOWED_KEYS = new Set(["strategy"]);
const RETRY_BACKOFF_FIXED_ALLOWED_KEYS = new Set(["strategy", "delayMs"]);
const RETRY_BACKOFF_EXPONENTIAL_ALLOWED_KEYS = new Set([
  "strategy",
  "initialDelayMs",
  "maxDelayMs"
]);
const IDEMPOTENCY_KEY_ALLOWED_KEYS = new Set([
  "source",
  "field",
  "required",
  "template",
  "value"
]);
const INPUT_IDEMPOTENCY_KEY_ALLOWED_KEYS = new Set(["source", "field", "required"]);
const WORKFLOW_IDEMPOTENCY_KEY_ALLOWED_KEYS = new Set(["source", "template"]);
const STATIC_IDEMPOTENCY_KEY_ALLOWED_KEYS = new Set(["source", "value"]);
const WORKFLOW_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "description",
  "metadata",
  "trigger",
  "steps"
]);
const STEP_ALLOWED_KEYS = new Set([
  "id",
  "name",
  "dependsOn",
  "action",
  "retry",
  "idempotencyKey",
  "metadata"
]);

export type WorkflowSchemaVersion = typeof WORKFLOW_SCHEMA_VERSION;

export interface WorkflowDefinition {
  schemaVersion: WorkflowSchemaVersion;
  id: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

export type WorkflowTrigger =
  | ManualWorkflowTrigger
  | ScheduleWorkflowTrigger
  | WebhookWorkflowTrigger;

interface WorkflowTriggerBase {
  type: string;
  idempotencyKey?: IdempotencyKeyDefinition;
}

export interface ManualWorkflowTrigger extends WorkflowTriggerBase {
  type: "manual";
}

export interface ScheduleWorkflowTrigger extends WorkflowTriggerBase {
  type: "schedule";
  cron: string;
}

export interface WebhookWorkflowTrigger extends WorkflowTriggerBase {
  type: "webhook";
  path: string;
}

export interface WorkflowStep {
  id: string;
  name?: string;
  dependsOn?: string[];
  action: WorkflowAction;
  retry?: RetryPolicy;
  idempotencyKey?: IdempotencyKeyDefinition;
  metadata?: Record<string, unknown>;
}

export interface WorkflowAction {
  type: "local" | "approval" | "notification";
  name: string;
  with?: Record<string, unknown>;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: RetryBackoffPolicy;
}

export type RetryBackoffPolicy =
  | { strategy: "none" }
  | { strategy: "fixed"; delayMs: number }
  | { strategy: "exponential"; initialDelayMs: number; maxDelayMs: number };

export type IdempotencyKeyDefinition =
  | {
      source: "input";
      field: string;
      required?: boolean;
    }
  | {
      source: "workflow";
      template: string;
    }
  | {
      source: "static";
      value: string;
    };

export interface WorkflowDefinitionValidationError {
  path: string;
  message: string;
}

export interface WorkflowDefinitionValidationResult {
  valid: boolean;
  errors: WorkflowDefinitionValidationError[];
}

export const workflowDefinitionSchemaVersion: WorkflowSchemaVersion =
  WORKFLOW_SCHEMA_VERSION;

export const validateWorkflowDefinition = (
  value: unknown
): WorkflowDefinitionValidationResult => {
  const errors: WorkflowDefinitionValidationError[] = [];

  if (!isRecord(value)) {
    return invalid("workflow definition must be an object");
  }

  rejectEnsenLoopSpecificFields(value, "", errors);
  rejectUnknownKeys(value, WORKFLOW_ALLOWED_KEYS, "", errors);
  requireLiteral(value, "schemaVersion", WORKFLOW_SCHEMA_VERSION, errors);
  requireStableId(value, "id", "workflow.id", errors);
  optionalString(value, "name", "workflow.name", errors);
  optionalString(value, "description", "workflow.description", errors);
  optionalRecord(value, "metadata", "workflow.metadata", errors);
  validateTrigger(value.trigger, errors);
  validateSteps(value.steps, errors);

  return { valid: errors.length === 0, errors };
};

const invalid = (message: string): WorkflowDefinitionValidationResult => ({
  valid: false,
  errors: [{ path: "workflow", message }]
});

const validateTrigger = (
  value: unknown,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (!isRecord(value)) {
    errors.push({ path: "trigger", message: "trigger must be an object" });
    return;
  }

  rejectEnsenLoopSpecificFields(value, "trigger", errors);
  const triggerType = value.type;
  if (triggerType === "manual") {
    rejectUnknownKeys(value, MANUAL_TRIGGER_ALLOWED_KEYS, "trigger", errors);
  } else if (triggerType === "schedule") {
    rejectUnknownKeys(value, SCHEDULE_TRIGGER_ALLOWED_KEYS, "trigger", errors);
  } else if (triggerType === "webhook") {
    rejectUnknownKeys(value, WEBHOOK_TRIGGER_ALLOWED_KEYS, "trigger", errors);
  } else {
    rejectUnknownKeys(value, TRIGGER_ALLOWED_KEYS, "trigger", errors);
  }

  if (typeof triggerType !== "string" || !TRIGGER_TYPES.has(triggerType)) {
    errors.push({
      path: "trigger.type",
      message: "trigger.type must be manual, schedule, or webhook"
    });
    return;
  }

  if (triggerType === "schedule") {
    requireNonEmptyString(value, "cron", "trigger.cron", errors);
  }

  if (triggerType === "webhook") {
    requireNonEmptyString(value, "path", "trigger.path", errors);
  }

  if ("idempotencyKey" in value) {
    validateIdempotencyKey(value.idempotencyKey, "trigger.idempotencyKey", errors);
  }
};

const validateSteps = (
  value: unknown,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({
      path: "steps",
      message: "steps must contain at least one workflow step"
    });
    return;
  }

  const stepIds = new Set<string>();

  value.forEach((step, index) => {
    const path = `steps[${index}]`;

    if (!isRecord(step)) {
      errors.push({ path, message: "step must be an object" });
      return;
    }

    rejectEnsenLoopSpecificFields(step, path, errors);
    rejectUnknownKeys(step, STEP_ALLOWED_KEYS, path, errors);
    requireStableId(step, "id", `${path}.id`, errors);

    if (typeof step.id === "string" && STABLE_ID_PATTERN.test(step.id)) {
      if (stepIds.has(step.id)) {
        errors.push({ path: `${path}.id`, message: "step.id must be unique" });
      }
      stepIds.add(step.id);
    }
  });

  value.forEach((step, index) => {
    if (!isRecord(step)) {
      return;
    }

    const path = `steps[${index}]`;
    optionalString(step, "name", `${path}.name`, errors);
    optionalRecord(step, "metadata", `${path}.metadata`, errors);
    validateDependencies(step.dependsOn, stepIds, step.id, `${path}.dependsOn`, errors);
    validateAction(step.action, `${path}.action`, errors);

    if ("retry" in step) {
      validateRetryPolicy(step.retry, `${path}.retry`, errors);
    }

    if ("idempotencyKey" in step) {
      validateIdempotencyKey(step.idempotencyKey, `${path}.idempotencyKey`, errors);
    }
  });
};

const validateDependencies = (
  value: unknown,
  stepIds: Set<string>,
  currentStepId: unknown,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    errors.push({ path, message: "dependsOn must be an array of step IDs" });
    return;
  }

  value.forEach((dependency, index) => {
    const dependencyPath = `${path}[${index}]`;
    if (typeof dependency !== "string" || !STABLE_ID_PATTERN.test(dependency)) {
      errors.push({
        path: dependencyPath,
        message: "dependsOn entries must be stable step IDs"
      });
      return;
    }

    if (typeof currentStepId === "string" && dependency === currentStepId) {
      errors.push({
        path: dependencyPath,
        message: "dependsOn entries cannot reference the current step"
      });
      return;
    }

    if (!stepIds.has(dependency)) {
      errors.push({
        path: dependencyPath,
        message: "dependsOn entries must reference an existing step"
      });
    }
  });
};

const validateAction = (
  value: unknown,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (!isRecord(value)) {
    errors.push({ path, message: "action must be an object" });
    return;
  }

  rejectUnknownKeys(value, ACTION_ALLOWED_KEYS, path, errors);

  if (typeof value.type !== "string" || !ACTION_TYPES.has(value.type)) {
    errors.push({
      path: `${path}.type`,
      message: "action.type must be local, approval, or notification"
    });
  }

  requireNonEmptyString(value, "name", `${path}.name`, errors);

  if ("with" in value && !isRecord(value.with)) {
    errors.push({ path: `${path}.with`, message: "action.with must be an object" });
  }
};

const validateRetryPolicy = (
  value: unknown,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (!isRecord(value)) {
    errors.push({ path, message: "retry must be an object" });
    return;
  }

  rejectUnknownKeys(value, RETRY_POLICY_ALLOWED_KEYS, path, errors);

  if (!isPositiveInteger(value.maxAttempts)) {
    errors.push({
      path: `${path}.maxAttempts`,
      message: "retry.maxAttempts must be a positive integer"
    });
  }

  if (!isRecord(value.backoff)) {
    errors.push({ path: `${path}.backoff`, message: "retry.backoff must be an object" });
    return;
  }

  const { strategy } = value.backoff;
  if (strategy === "none") {
    rejectUnknownKeys(value.backoff, RETRY_BACKOFF_NONE_ALLOWED_KEYS, `${path}.backoff`, errors);
  } else if (strategy === "fixed") {
    rejectUnknownKeys(value.backoff, RETRY_BACKOFF_FIXED_ALLOWED_KEYS, `${path}.backoff`, errors);
  } else if (strategy === "exponential") {
    rejectUnknownKeys(
      value.backoff,
      RETRY_BACKOFF_EXPONENTIAL_ALLOWED_KEYS,
      `${path}.backoff`,
      errors
    );
  } else {
    rejectUnknownKeys(value.backoff, RETRY_BACKOFF_ALLOWED_KEYS, `${path}.backoff`, errors);
  }

  if (typeof strategy !== "string" || !BACKOFF_STRATEGIES.has(strategy)) {
    errors.push({
      path: `${path}.backoff.strategy`,
      message: "retry.backoff.strategy must be none, fixed, or exponential"
    });
    return;
  }

  if (strategy === "fixed" && !isNonNegativeInteger(value.backoff.delayMs)) {
    errors.push({
      path: `${path}.backoff.delayMs`,
      message: "fixed retry backoff requires a non-negative delayMs"
    });
  }

  if (strategy === "exponential") {
    if (!isNonNegativeInteger(value.backoff.initialDelayMs)) {
      errors.push({
        path: `${path}.backoff.initialDelayMs`,
        message: "exponential retry backoff requires a non-negative initialDelayMs"
      });
    }

    if (!isNonNegativeInteger(value.backoff.maxDelayMs)) {
      errors.push({
        path: `${path}.backoff.maxDelayMs`,
        message: "exponential retry backoff requires a non-negative maxDelayMs"
      });
    }
  }
};

const validateIdempotencyKey = (
  value: unknown,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (!isRecord(value)) {
    errors.push({ path, message: "idempotencyKey must be an object" });
    return;
  }

  const idempotencyKeySource = value.source;
  if (idempotencyKeySource === "input") {
    rejectUnknownKeys(value, INPUT_IDEMPOTENCY_KEY_ALLOWED_KEYS, path, errors);
  } else if (idempotencyKeySource === "workflow") {
    rejectUnknownKeys(value, WORKFLOW_IDEMPOTENCY_KEY_ALLOWED_KEYS, path, errors);
  } else if (idempotencyKeySource === "static") {
    rejectUnknownKeys(value, STATIC_IDEMPOTENCY_KEY_ALLOWED_KEYS, path, errors);
  } else {
    rejectUnknownKeys(value, IDEMPOTENCY_KEY_ALLOWED_KEYS, path, errors);
  }

  if (
    typeof idempotencyKeySource !== "string" ||
    !IDEMPOTENCY_KEY_SOURCES.has(idempotencyKeySource)
  ) {
    errors.push({
      path: `${path}.source`,
      message: "idempotencyKey.source must be input, workflow, or static"
    });
    return;
  }

  if (idempotencyKeySource === "input") {
    requireNonEmptyString(value, "field", `${path}.field`, errors);
    if ("required" in value && typeof value.required !== "boolean") {
      errors.push({
        path: `${path}.required`,
        message: "input idempotency required flag must be boolean"
      });
    }
  }

  if (idempotencyKeySource === "workflow") {
    requireNonEmptyString(value, "template", `${path}.template`, errors);
  }

  if (idempotencyKeySource === "static") {
    requireNonEmptyString(value, "value", `${path}.value`, errors);
  }
};

const requireLiteral = (
  value: Record<string, unknown>,
  key: string,
  expected: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (value[key] !== expected) {
    errors.push({
      path: `workflow.${key}`,
      message: `${key} must be ${expected}`
    });
  }
};

const requireStableId = (
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (typeof value[key] !== "string" || !STABLE_ID_PATTERN.test(value[key])) {
    errors.push({
      path,
      message: `${key} must be a stable kebab-case identifier`
    });
  }
};

const requireNonEmptyString = (
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (typeof value[key] !== "string" || value[key].trim() === "") {
    errors.push({ path, message: `${key} must be a non-empty string` });
  }
};

const optionalString = (
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (key in value && typeof value[key] !== "string") {
    errors.push({ path, message: `${key} must be a string when provided` });
  }
};

const optionalRecord = (
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  if (key in value && !isRecord(value[key])) {
    errors.push({ path, message: `${key} must be an object when provided` });
  }
};

const rejectEnsenLoopSpecificFields = (
  value: Record<string, unknown>,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  for (const key of ["ensenLoop", "ensenLoopField", "loopQueue", "executorConnector"]) {
    if (key in value) {
      errors.push({
        path: path ? `${path}.${key}` : `workflow.${key}`,
        message: `${key} is outside the workflow definition schema boundary`
      });
    }
  }
};

const rejectUnknownKeys = (
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  path: string,
  errors: WorkflowDefinitionValidationError[]
): void => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        path: path ? `${path}.${key}` : `workflow.${key}`,
        message: `${key} is outside the workflow definition schema boundary`
      });
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
