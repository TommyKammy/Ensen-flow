export type UnsafeWorkflowArtifactCategory =
  | "secret"
  | "credential"
  | "token"
  | "private-key"
  | "session-cookie"
  | "regulated-content"
  | "customer-identifier"
  | "workstation-local-path";

export interface UnsafeWorkflowArtifactFinding {
  path: string;
  category: UnsafeWorkflowArtifactCategory;
}

const TOKEN_VALUE_PATTERN =
  /\b(?:ghp|github_pat|glpat|xox[abprs]|sk)[-_][A-Za-z0-9_-]{8,}\b/u;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY[A-Z ]*-----/u;
const SECRET_ASSIGNMENT_PATTERN =
  /(?:^|\b)(?:password|passwd|secret|api[_-]?key|access[_-]?key)\s*[:=]/iu;
const TOKEN_ASSIGNMENT_PATTERN = /(?:^|\b)token\s*[:=]/iu;
const SESSION_COOKIE_PATTERN =
  /(?:^|\b)(?:cookie|set-cookie)\s*:\s*[^;\n]*(?:session|sid)=|(?:^|\b)(?:sessionid|session_id|sid)\s*=/iu;
const REGULATED_CONTENT_ASSIGNMENT_PATTERN =
  /(?:^|\b)(?:ssn|social[_ -]?security[_ -]?number|patient[_ -]?id|patient[_ -]?name|medical[_ -]?record[_ -]?number|mrn)\s*["']?\s*[:=]/iu;
const CUSTOMER_IDENTIFIER_ASSIGNMENT_PATTERN =
  /(?:^|\b)(?:customer[_ -]?id|customer[_ -]?name|customer[_ -]?email|account[_ -]?number)\s*["']?\s*[:=]/iu;
const WORKSTATION_LOCAL_PATH_PATTERN =
  /(?:^|["'\s])(?:\/(?:Users|home|var|tmp|opt|etc|srv|mnt|root|Volumes|usr)\/[^/\\\s]+|[A-Za-z]:[\\/][^/\\\s]+|file:\/\/\/(?:[A-Za-z]:\/|(?:Users|home|var|tmp|opt|etc|srv|mnt|root|Volumes|usr)\/)[^/\\\s]+)/u;
const CREDENTIAL_FIELD_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "apikey",
  "accesskey",
  "privatekey",
  "token",
  "sessioncookie",
  "sessionid",
  "credential",
  "credentials"
]);
const REGULATED_FIELD_KEYS = new Set([
  "ssn",
  "socialsecuritynumber",
  "patientid",
  "patientname",
  "medicalrecordnumber",
  "mrn"
]);
const CUSTOMER_IDENTIFIER_FIELD_KEYS = new Set([
  "customerid",
  "customername",
  "customeremail",
  "accountnumber"
]);
const TOKEN_BEARING_FIELD_KEY_MARKERS = ["token"];
const CREDENTIAL_BEARING_FIELD_KEY_MARKERS = [
  "authorization",
  "password",
  "passwd",
  "secret",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "sessioncookie",
  "sessionid"
];

export const findUnsafeWorkflowArtifactValue = (
  value: unknown,
  path: string
): UnsafeWorkflowArtifactFinding | undefined => {
  if (typeof value === "string") {
    const parsed = parseJsonFormattedContainer(value);
    if (parsed !== undefined) {
      const nested = findUnsafeWorkflowArtifactValue(parsed, path);
      if (nested !== undefined) {
        return nested;
      }
    }

    const category = classifyUnsafeWorkflowArtifactString(value);
    return category === undefined ? undefined : { path, category };
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findUnsafeWorkflowArtifactValue(value[index], `${path}[${index}]`);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      const nested = findUnsafeWorkflowArtifactValue(nestedValue, nestedPath);
      if (nested !== undefined) {
        return nested;
      }

      const keyedCategory = classifyUnsafeWorkflowArtifactKey(key, nestedValue);
      if (keyedCategory !== undefined) {
        return { path: nestedPath, category: keyedCategory };
      }
    }
  }

  return undefined;
};

export const classifyUnsafeWorkflowArtifactString = (
  value: string
): UnsafeWorkflowArtifactCategory | undefined => {
  if (PRIVATE_KEY_BLOCK_PATTERN.test(value)) {
    return "private-key";
  }

  if (TOKEN_VALUE_PATTERN.test(value) || TOKEN_ASSIGNMENT_PATTERN.test(value)) {
    return "token";
  }

  if (SESSION_COOKIE_PATTERN.test(value)) {
    return "session-cookie";
  }

  if (REGULATED_CONTENT_ASSIGNMENT_PATTERN.test(value)) {
    return "regulated-content";
  }

  if (CUSTOMER_IDENTIFIER_ASSIGNMENT_PATTERN.test(value)) {
    return "customer-identifier";
  }

  if (SECRET_ASSIGNMENT_PATTERN.test(value)) {
    return "secret";
  }

  if (WORKSTATION_LOCAL_PATH_PATTERN.test(value)) {
    return "workstation-local-path";
  }

  return undefined;
};

const classifyUnsafeWorkflowArtifactKey = (
  key: string,
  value: unknown
): UnsafeWorkflowArtifactCategory | undefined => {
  if (isEmptyPublicPlaceholder(value)) {
    return undefined;
  }

  const normalized = normalizeArtifactKey(key);
  const tokenBearingCategory = classifyTokenBearingArtifactKey(normalized);
  if (tokenBearingCategory !== undefined) {
    return tokenBearingCategory;
  }

  if (CREDENTIAL_FIELD_KEYS.has(normalized)) {
    return normalized === "cookie" || normalized === "setcookie" || normalized === "sessioncookie"
      ? "session-cookie"
      : "credential";
  }

  const credentialBearingCategory = classifyCredentialBearingArtifactKey(normalized);
  if (credentialBearingCategory !== undefined) {
    return credentialBearingCategory;
  }

  if (REGULATED_FIELD_KEYS.has(normalized)) {
    return "regulated-content";
  }

  if (CUSTOMER_IDENTIFIER_FIELD_KEYS.has(normalized)) {
    return "customer-identifier";
  }

  return undefined;
};

const normalizeArtifactKey = (key: string): string =>
  key.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();

const classifyTokenBearingArtifactKey = (
  normalizedKey: string
): UnsafeWorkflowArtifactCategory | undefined => {
  if (!TOKEN_BEARING_FIELD_KEY_MARKERS.some((marker) => normalizedKey.includes(marker))) {
    return undefined;
  }

  return normalizedKey.includes("cookie") || normalizedKey.includes("session")
    ? "session-cookie"
    : "credential";
};

const classifyCredentialBearingArtifactKey = (
  normalizedKey: string
): UnsafeWorkflowArtifactCategory | undefined => {
  if (!CREDENTIAL_BEARING_FIELD_KEY_MARKERS.some((marker) => normalizedKey.includes(marker))) {
    return undefined;
  }

  return normalizedKey.includes("cookie") || normalizedKey.includes("session")
    ? "session-cookie"
    : "credential";
};

const parseJsonFormattedContainer = (value: string): unknown[] | Record<string, unknown> | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) || isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isEmptyPublicPlaceholder = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  isEmptyPlainObject(value);

const isEmptyPlainObject = (value: unknown): boolean => {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const formatUnsafeWorkflowArtifactDiagnostic = (
  finding: UnsafeWorkflowArtifactFinding
): string =>
  `${finding.path} must not contain unsafe workflow artifact values (category: ${finding.category})`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
