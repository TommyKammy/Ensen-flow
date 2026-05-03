export type UnsafeWorkflowArtifactCategory =
  | "secret"
  | "token"
  | "private-key"
  | "session-cookie"
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
const WORKSTATION_LOCAL_PATH_PATTERN =
  /(?:^|["'\s])(?:\/(?:Users|home|var|tmp|opt|etc|srv|mnt|root|Volumes|usr)\/[^/\\\s]+|[A-Za-z]:[\\/][^/\\\s]+|file:\/\/\/(?:[A-Za-z]:\/|(?:Users|home|var|tmp|opt|etc|srv|mnt|root|Volumes|usr)\/)[^/\\\s]+)/u;

export const findUnsafeWorkflowArtifactValue = (
  value: unknown,
  path: string
): UnsafeWorkflowArtifactFinding | undefined => {
  if (typeof value === "string") {
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
      const nested = findUnsafeWorkflowArtifactValue(nestedValue, `${path}.${key}`);
      if (nested !== undefined) {
        return nested;
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

  if (SECRET_ASSIGNMENT_PATTERN.test(value)) {
    return "secret";
  }

  if (WORKSTATION_LOCAL_PATH_PATTERN.test(value)) {
    return "workstation-local-path";
  }

  return undefined;
};

export const formatUnsafeWorkflowArtifactDiagnostic = (
  finding: UnsafeWorkflowArtifactFinding
): string =>
  `${finding.path} must not contain unsafe workflow artifact values (category: ${finding.category})`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
