# Agent harness

Read this file completely before changing the repo. Then read the plan. Explore the code. Docs can be stale; the code and a check you ran are the evidence.

## Sources of truth

Design lives in the plan markdown in this repo. Look, in order, for a plan already named in the conversation, then `ARCHITECTURE.md`, `PLAN.md`, `IMPLEMENTATION_PLAN.md`, and `ROADMAP.md` (repo root or `docs/`). The plan is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The agreed problem space is in [docs/PROBLEM_SPACE.md](docs/PROBLEM_SPACE.md), with users and UX flows in [docs/USERS.md](docs/USERS.md); read both before writing the plan. Do not invent product behavior, a stack, or an architecture.

The plan records design. Do not tick its checkboxes as status, and do not restate it into a new document.

Status lives only on the Notion board named in [docs/status-board.md](docs/status-board.md). Do not create `IMPLEMENTATION.md` or any other kanban. For this repo, ignore the personal `plan-implementer` skills and their in-repo board.

Past project lessons live in `C:\Users\joshu\.agents\workflow-reports`, not in this repo. Read the newest report for each project before architecture and before a new plan. Older reports stay. Do not rewrite them. A new report is a dated file in that folder, and the README index there is updated.

## Submission logs

Required deliverables are the README, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/AI_USAGE.md](docs/AI_USAGE.md), the deployed URL, and a demo video. Each has a card on the status board.

When work makes a decision with a trade-off, cuts something, or corrects the AI, log it in the same commit as the work: decisions and cuts in DECISIONS.md, AI corrections in AI_USAGE.md. Do not rebuild these logs at the end.

## Skills

Follow the project skills in `.cursor/skills/`. They replace the personal `plan-implementer` skills here. Claude Code loads the same skills from a copy in `.claude/skills/`. Edit `.cursor/skills/` first, then copy the change. `npm run verify` fails if the copies differ (D41).

- `grill` before a Notion card is seeded, and again before every commit. A skipped grill means no commit.
- `tdd-plan-implementer` when implementing a slice of the plan
- `parallel-delivery` when splitting that work across agents
- `frontend-engineer` when the slice has UI

`frontend-design` is the visual skill for a new or reshaped page. `plan-creator` is for writing the plan. The repo plan wins if `frontend-design` would invent a subject.

## Working rules

If a routine technical choice is at least 80% certain, decide and proceed. Stop for scope, a public API, schema or data flow, auth, and spend. Stop again before every commit and run `grill` on the diff. Do not commit in that same message.

Parallel agents share no files. The same file means one owner, in sequence. A slice with UI stays on the main checkout and uses the one dev server. A new session starts from the plan and the Notion card, not from chat memory.
