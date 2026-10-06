// `npm run push`: verify once, then push the current branch to GitHub and
// GitLab (D36). Graders may read either remote.
import { execSync } from "node:child_process";
import { run, runOrExit } from "./run.ts";

runOrExit("npm run verify");

const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const failed = ["origin", "gitlab"].filter((remote) => !run(`git push ${remote} ${branch}`));

if (failed.length > 0) {
  console.error(`\nPush failed for: ${failed.join(", ")}. The other remote may now be ahead.`);
  process.exit(1);
}
console.log(`\nPushed ${branch} to origin and gitlab.`);
