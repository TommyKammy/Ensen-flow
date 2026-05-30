#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createAuditEvidenceExport,
  loadWorkflowDefinitionFile,
  runSelectedControlledPilot,
  runWorkflow
} from "./index.js";
import type { ControlledPilotInputPackage } from "./index.js";

const printUsage = (): void => {
  console.error(
    [
      "Usage:",
      "  node dist/cli.js run <workflow-definition.json> <state.jsonl> [trigger-context-json]",
      "  node dist/cli.js run-controlled-pilot <input-package.json> <state-root> [audit.jsonl]",
      "  node dist/cli.js export-audit-evidence <state.jsonl> [audit.jsonl] [--output <export.json>]"
    ].join("\n")
  );
};

export const runCli = async (argv: string[]): Promise<number> => {
  const [command] = argv;

  if (command === "run") {
    return runWorkflowCommand(argv.slice(1));
  }

  if (command === "run-controlled-pilot") {
    return runControlledPilotCommand(argv.slice(1));
  }

  if (command === "export-audit-evidence") {
    return runAuditEvidenceExportCommand(argv.slice(1));
  }

  printUsage();
  return 2;
};

const runWorkflowCommand = async (argv: string[]): Promise<number> => {
  const [definitionPath, statePath, triggerContextJson] = argv;

  if (definitionPath === undefined || statePath === undefined) {
    printUsage();
    return 2;
  }

  const triggerContext = parseTriggerContext(triggerContextJson);
  const definition = await loadWorkflowDefinitionFile(definitionPath);
  const state = await runWorkflow({
    definition,
    statePath,
    triggerContext
  });

  console.log(
    JSON.stringify(
      {
        runId: state.run.runId,
        workflowId: state.run.workflowId,
        status: state.run.status,
        terminalState: state.run.terminalState,
        statePath
      },
      null,
      2
    )
  );

  return 0;
};

const runControlledPilotCommand = async (argv: string[]): Promise<number> => {
  const [inputPackagePath, stateRoot, auditPath] = argv;

  if (inputPackagePath === undefined || stateRoot === undefined || argv.length > 3) {
    printUsage();
    return 2;
  }

  const inputPackage = await readControlledPilotInputPackageFile(inputPackagePath);
  const state = await runSelectedControlledPilot({
    inputPackage,
    stateRoot,
    ...(auditPath === undefined ? {} : { auditPath })
  });

  console.log(
    JSON.stringify(
      {
        pilotId: inputPackage.pilotId,
        mode: inputPackage.mode,
        runId: state.run.runId,
        workflowId: state.run.workflowId,
        status: state.run.status,
        terminalState: state.run.terminalState,
        stateRoot,
        ...(auditPath === undefined ? {} : { auditPath })
      },
      null,
      2
    )
  );

  return 0;
};

const runAuditEvidenceExportCommand = async (argv: string[]): Promise<number> => {
  const parsed = parseAuditEvidenceExportArgs(argv);
  if (parsed === undefined) {
    printUsage();
    return 2;
  }

  const exportArtifact = await createAuditEvidenceExport(parsed);
  console.log(JSON.stringify(exportArtifact, null, 2));

  return 0;
};

const parseAuditEvidenceExportArgs = (
  argv: string[]
): { statePath: string; auditPath?: string; outputPath?: string } | undefined => {
  if (argv.length < 1 || argv.length > 4) {
    return undefined;
  }

  const [statePath, maybeAuditPath, maybeOutputFlag, maybeOutputPath] = argv;

  if (maybeAuditPath === "--output") {
    if (maybeOutputFlag === undefined || maybeOutputPath !== undefined) {
      return undefined;
    }

    return {
      statePath,
      outputPath: maybeOutputFlag
    };
  }

  if (maybeOutputFlag === undefined) {
    return {
      statePath,
      ...(maybeAuditPath === undefined ? {} : { auditPath: maybeAuditPath })
    };
  }

  if (maybeOutputFlag !== "--output" || maybeOutputPath === undefined) {
    return undefined;
  }

  return {
    statePath,
    ...(maybeAuditPath === undefined ? {} : { auditPath: maybeAuditPath }),
    outputPath: maybeOutputPath
  };
};

const readControlledPilotInputPackageFile = async (
  inputPackagePath: string
): Promise<ControlledPilotInputPackage> => {
  const parsed = JSON.parse(await readFile(inputPackagePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("controlled pilot input package JSON must be an object");
  }

  return parsed as unknown as ControlledPilotInputPackage;
};

const parseTriggerContext = (
  triggerContextJson: string | undefined
): Record<string, unknown> => {
  if (triggerContextJson === undefined) {
    return {};
  }

  const parsed = JSON.parse(triggerContextJson) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("trigger context JSON must be an object");
  }

  return parsed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
