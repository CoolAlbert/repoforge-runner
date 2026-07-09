import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogEvent, type LogEvent } from "@repoforge/logstream";

interface RunnerConfig {
  controlUrl: string;
  runId: string;
  projectId: string;
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
  dryRun: boolean;
  keepWorkspace: boolean;
}

function configFromEnv(): RunnerConfig {
  const required = ["REPOFORGE_CONTROL_URL", "REPOFORGE_RUN_ID", "REPOFORGE_PROJECT_ID", "REPOFORGE_REPO_URL", "REPOFORGE_PROMPT"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }
  return {
    controlUrl: process.env.REPOFORGE_CONTROL_URL!,
    runId: process.env.REPOFORGE_RUN_ID!,
    projectId: process.env.REPOFORGE_PROJECT_ID!,
    repoUrl: process.env.REPOFORGE_REPO_URL!,
    branch: process.env.REPOFORGE_BRANCH || undefined,
    prompt: process.env.REPOFORGE_PROMPT!,
    model: process.env.REPOFORGE_MODEL || undefined,
    dryRun: process.env.REPOFORGE_DRY_RUN === "1",
    keepWorkspace: process.env.REPOFORGE_KEEP_WORKSPACE === "1"
  };
}

async function post(path: string, body: unknown): Promise<void> {
  const config = currentConfig;
  const response = await fetch(`${config.controlUrl}${path}`, {
    method: path.endsWith("/logs") ? "POST" : "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Control API ${response.status}: ${text}`);
  }
}

async function log(stream: LogEvent["stream"], level: LogEvent["level"], msg: string, step?: string, meta?: Record<string, unknown>): Promise<void> {
  await post(`/runs/${currentConfig.runId}/logs`, createLogEvent({
    projectId: currentConfig.projectId,
    runId: currentConfig.runId,
    stream,
    level,
    msg,
    step,
    meta
  }));
}

function runCommand(command: string, args: string[], cwd: string, step: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    child.stdout.on("data", (data) => void log("stdout", "info", String(data), step));
    child.stderr.on("data", (data) => void log("stderr", "warn", String(data), step));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let currentConfig: RunnerConfig;

async function main(): Promise<void> {
  currentConfig = configFromEnv();
  await post(`/runs/${currentConfig.runId}`, { status: "running" });
  await log("system", "info", "Runner started", "start", {
    repoUrl: currentConfig.repoUrl,
    model: currentConfig.model,
    dryRun: currentConfig.dryRun
  });

  const workspace = await mkdtemp(join(tmpdir(), "repoforge-"));
  try {
    if (currentConfig.dryRun) {
      await log("system", "info", "Dry run enabled; skipping git clone and pi execution.", "dry-run", { workspace });
      await post(`/runs/${currentConfig.runId}`, { status: "completed", exitCode: 0 });
      return;
    }

    const cloneArgs = ["clone", "--depth", "1"];
    if (currentConfig.branch) cloneArgs.push("--branch", currentConfig.branch);
    cloneArgs.push(currentConfig.repoUrl, "repo");
    const cloneCode = await runCommand("git", cloneArgs, workspace, "clone");
    if (cloneCode !== 0) throw new Error(`git clone exited with ${cloneCode}`);

    const repoDir = join(workspace, "repo");
    const promptFile = join(workspace, "prompt.md");
    await writeFile(promptFile, currentConfig.prompt);
    const piArgs = ["-p", `@${promptFile}`, "--name", `RepoForge ${currentConfig.runId}`];
    if (currentConfig.model) piArgs.unshift("--model", currentConfig.model);
    const piCode = await runCommand("pi", piArgs, repoDir, "pi-agent");
    await post(`/runs/${currentConfig.runId}`, {
      status: piCode === 0 ? "completed" : "failed",
      exitCode: piCode
    });
  } catch (error) {
    await log("system", "error", (error as Error).message, "error");
    await post(`/runs/${currentConfig.runId}`, { status: "failed", error: (error as Error).message });
    process.exitCode = 1;
  } finally {
    if (!currentConfig.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
