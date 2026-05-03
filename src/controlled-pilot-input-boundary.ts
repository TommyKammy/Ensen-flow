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

  if (input.boundary.mode === "fake" || input.boundary.mode === "local" || input.boundary.mode === "dry-run") {
    return undefined;
  }

  const evidence = input.boundary.dryRunFirstEvidence;
  const override = input.boundary.override;
  if (
    evidence === undefined ||
    !isNonEmptyString(evidence?.reference) ||
    override === undefined ||
    !isNonEmptyString(override?.approvedBy) ||
    !isNonEmptyString(override?.approvedAt) ||
    !isNonEmptyString(override?.reason)
  ) {
    return `${input.surface} real input requires explicit dry-run-first evidence and a human-controlled override`;
  }

  return undefined;
};
