// Fails when .claude/skills/ (read by Claude Code) drifts from .cursor/skills/
// (the source, read by Cursor). D41: edit .cursor/skills/ first, then copy.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillProblem = {
  path: string;
  problem: "differs" | "missing from the copy" | "only in the copy";
};

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

function readNormalized(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

export function compareSkillDirs(source: string, copy: string): SkillProblem[] {
  const sourceFiles = new Set(listFiles(source));
  const copyFiles = new Set(listFiles(copy));
  const problems: SkillProblem[] = [];

  for (const path of [...new Set([...sourceFiles, ...copyFiles])].sort()) {
    if (!copyFiles.has(path)) problems.push({ path, problem: "missing from the copy" });
    else if (!sourceFiles.has(path)) problems.push({ path, problem: "only in the copy" });
    else if (readNormalized(join(source, path)) !== readNormalized(join(copy, path))) {
      problems.push({ path, problem: "differs" });
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = compareSkillDirs(".cursor/skills", ".claude/skills");
  if (problems.length === 0) {
    console.log("Skills: .claude/skills matches .cursor/skills");
  } else {
    console.error("Skills: .claude/skills has drifted from .cursor/skills (D41):");
    for (const { path, problem } of problems) console.error(`  ${path}: ${problem}`);
    console.error("Edit .cursor/skills first, then copy it to .claude/skills.");
    process.exit(1);
  }
}
