// Shared by setup, verify and push. Commands are fixed strings, never user
// input, so running them through the shell is safe (and needed for npm on Windows).
import { spawnSync } from "node:child_process";

export function run(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  console.log(`\n> ${command}`);
  return spawnSync(command, { shell: true, stdio: "inherit", env }).status === 0;
}

export function runOrExit(command: string, env?: NodeJS.ProcessEnv): void {
  if (!run(command, env)) {
    console.error(`\nFailed: ${command}`);
    process.exit(1);
  }
}
