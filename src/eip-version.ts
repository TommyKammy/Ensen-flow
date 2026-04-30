export interface EipVersionBoundary {
  sourceRepository: "TommyKammy/Ensen-protocol";
  snapshotReleaseTag: "v0.1.0";
  supportedProtocolVersion: "0.1.0";
  runtimeDependency: false;
  unsupportedMajorVersionPolicy: "fail-closed until an explicit Ensen-flow connector boundary supports the new EIP major version";
}

export const eipVersionBoundary: EipVersionBoundary = {
  sourceRepository: "TommyKammy/Ensen-protocol",
  snapshotReleaseTag: "v0.1.0",
  supportedProtocolVersion: "0.1.0",
  runtimeDependency: false,
  unsupportedMajorVersionPolicy:
    "fail-closed until an explicit Ensen-flow connector boundary supports the new EIP major version"
};

export const isSupportedEipProtocolVersion = (protocolVersion: string): boolean =>
  protocolVersion === eipVersionBoundary.supportedProtocolVersion;
