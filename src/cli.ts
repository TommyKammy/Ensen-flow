#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import {
  createAuditEvidenceExport,
  loadWorkflowDefinitionFile,
  runWorkflow
} from "./index.js";

const printUsage = (): void => {
  console.error(
    [
      "Usage:",
      "  node dist/cli.js run <workflow-definition.json> <state.jsonl> [trigger-context-json]",
      "  node dist/cli.js export-audit-evidence <state.jsonl> [audit.jsonl] [--output <export.json>]"
    ].join("\n")
  );
};

export const runCli = async (argv: string[]): Promise<number> => {
  const [command] = argv;

  if (command === "run") {
    return runWorkflowCommand(argv.slice(1));
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
