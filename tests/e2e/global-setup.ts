// Rebuilds the demo data before the browser tests, so each run starts from the
// same seed. This resets the local app database, which `npm run seed` can
// rebuild at any time.
import { execFileSync } from "node:child_process";

export default function globalSetup(): void {
  execFileSync(process.execPath, ["--env-file-if-exists=.env", "scripts/seed.ts", "--reset"], { stdio: "inherit" });
}
