// Which build is answering, for GET /api/health (ARCHITECTURE.md §8). Without
// it, a slice that changes no pages looks the same live as the build before.

/** The latest milestone in this build. Each milestone's commit updates it. */
export const MILESTONE = "L7";

export type Release = { milestone: string; commit: string | null };

export function currentRelease(): Release {
  // Render sets RENDER_GIT_COMMIT to the deployed commit; elsewhere it's unset.
  const commit = process.env.RENDER_GIT_COMMIT;
  return { milestone: MILESTONE, commit: commit ? commit.slice(0, 7) : null };
}
