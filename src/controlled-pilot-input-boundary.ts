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

export const explainControlledPilotBoundaryRejection = (
  input: {
    surface: string;
    boundary?: ControlledPilotInputBoundary;
  }
): string | undefined => {
  const prefix = `${input.surface} must declare a fake, local, or dry-run input boundary`;
  if (input.boundary === undefined) {
    return `${prefix} before controlled pilot use`;
  }

  if (input.boundary.mode === "fake" || input.boundary.mode === "local" || input.boundary.mode === "dry-run") {
    return undefined;
  }

  const evidence = input.boundary.dryRunFirstEvidence;
  const override = input.boundary.override;
  if (
    evidence === undefined ||
    evidence.reference.trim() === "" ||
    override === undefined ||
    override.approvedBy.trim() === "" ||
    override.approvedAt.trim() === "" ||
    override.reason.trim() === ""
  ) {
    return `${input.surface} real input requires explicit dry-run-first evidence and a human-controlled override`;
  }

  return undefined;
};
