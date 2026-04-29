#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { loadWorkflowDefinitionFile, runWorkflow } from "./index.js";

const printUsage = (): void => {
  console.error(
    "Usage: node dist/cli.js run <workflow-definition.json> <state.jsonl> [trigger-context-json]"
  );
};

export const runCli = async (argv: string[]): Promise<number> => {
  const [command, definitionPath, statePath, triggerContextJson] = argv;

  if (command !== "run" || definitionPath === undefined || statePath === undefined) {
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
