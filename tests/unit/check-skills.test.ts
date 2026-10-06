import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareSkillDirs } from "../../scripts/check-skills";

const made: string[] = [];

function skillsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("compareSkillDirs", () => {
  it("finds nothing when the copy matches the source", () => {
    const files = { "grill/SKILL.md": "# Grill\n", "tdd/SKILL.md": "# TDD\n" };
    expect(compareSkillDirs(skillsDir(files), skillsDir(files))).toEqual([]);
  });

  it("reports a file whose content differs", () => {
    const source = skillsDir({ "grill/SKILL.md": "# Grill\nAsk once.\n" });
    const copy = skillsDir({ "grill/SKILL.md": "# Grill\nAsk twice.\n" });
    expect(compareSkillDirs(source, copy)).toEqual([
      { path: "grill/SKILL.md", problem: "differs" },
    ]);
  });

  it("reports files missing from either side", () => {
    const source = skillsDir({ "grill/SKILL.md": "a", "tdd/SKILL.md": "b" });
    const copy = skillsDir({ "grill/SKILL.md": "a", "extra/SKILL.md": "c" });
    expect(compareSkillDirs(source, copy)).toEqual([
      { path: "extra/SKILL.md", problem: "only in the copy" },
      { path: "tdd/SKILL.md", problem: "missing from the copy" },
    ]);
  });

  it("treats Windows and Unix line endings as the same", () => {
    const source = skillsDir({ "grill/SKILL.md": "# Grill\r\nAsk once.\r\n" });
    const copy = skillsDir({ "grill/SKILL.md": "# Grill\nAsk once.\n" });
    expect(compareSkillDirs(source, copy)).toEqual([]);
  });
});
