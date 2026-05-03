export type DryRunFirstInputBoundaryMode = "fake" | "local" | "dry-run";
export type ControlledPilotInputBoundaryMode = DryRunFirstInputBoundaryMode | "real";

export interface ControlledPilotOverride {
  approvedBy: string;
  approvedAt: string;
  reason: string;
}

export interface DryRunFirstEvidence {
  mode: DryRunFirstInputBoundaryMode;
  reference: string;
}

export interface ControlledPilotInputBoundary {
  mode: ControlledPilotInputBoundaryMode;
  dryRunFirstEvidence?: DryRunFirstEvidence;
  override?: ControlledPilotOverride;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const maxBoundaryMetadataStringLength = 256;
const strictIsoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isBoundedString = (value: unknown): value is string =>
  isNonEmptyString(value) && value.length <= maxBoundaryMetadataStringLength;

const isDryRunFirstInputBoundaryMode = (
  value: unknown
): value is DryRunFirstInputBoundaryMode =>
  value === "fake" || value === "local" || value === "dry-run";

const isStrictIsoTimestamp = (value: unknown): value is string => {
  if (!isBoundedString(value) || !strictIsoTimestampPattern.test(value)) {
    return false;
  }

  const parsed = new Date(value);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

export const explainControlledPilotBoundaryRejection = (
  input: {
    surface: string;
    boundary?: ControlledPilotInputBoundary;
  }
): string | undefined => {
  const prefix = `${input.surface} must declare a fake, local, or dry-run input boundary`;
  if (input.boundary === undefined || input.boundary === null) {
    return `${prefix} before controlled pilot use`;
  }

  if (isDryRunFirstInputBoundaryMode(input.boundary.mode)) {
    return undefined;
  }

  if (input.boundary.mode !== "real") {
    return `${input.surface} must declare a fake, local, dry-run, or explicitly approved real input boundary before controlled pilot use`;
  }

  const evidence = input.boundary.dryRunFirstEvidence;
  const override = input.boundary.override;
  if (
    evidence === undefined ||
    !isDryRunFirstInputBoundaryMode(evidence?.mode) ||
    !isBoundedString(evidence?.reference) ||
    override === undefined ||
    !isBoundedString(override?.approvedBy) ||
    !isStrictIsoTimestamp(override?.approvedAt) ||
    !isBoundedString(override?.reason)
  ) {
    return `${input.surface} real input requires explicit dry-run-first evidence and a human-controlled override`;
  }

  return undefined;
};
