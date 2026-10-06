# Harness follow-ups

Design for three additions to the agent harness. Status lives on the Notion board named in [status-board.md](status-board.md). This file does not track progress.

Source: tips from `#help` and `#cohort-main`. Do not install Matt Pocock's skills repo or extra MCP servers for this work.

Implement in this order. The first two both edit `tdd-plan-implementer`, so they cannot run at the same time.

## 1. Grill before a card is seeded

Before `tdd-plan-implementer` creates a Notion card, run a short grilling pass. Ask from three angles until the acceptance criteria are specific: product (who it is for and what is out of scope), engineering (files, contracts, and failure behavior), and QA (the checks that prove it, including a negative case).

Write the questions in one message. If an answer is at least 80% certain and is a routine technical choice, record it as an assumption and continue. Stop when a question changes scope, a public API, schema or data flow, auth, or spend.

Seed the card only after the user has answered, or has accepted the named assumptions. The card's acceptance criteria are those answers, not a restatement of the whole plan.

Add a project skill, `.cursor/skills/grill/SKILL.md`, and point to it from [AGENTS.md](../AGENTS.md) and from section 1 of `.cursor/skills/tdd-plan-implementer/SKILL.md`.

Done when a dry run on a sample slice produces questions, records assumptions, and does not create a card before that pass.

## 2. Closeout note on the card

When a slice is ready for Done, the Evidence property must include three parts:

- the command that ran and its result, including the failure seen before the code
- judgment calls made without the user
- what the diff review found (scope, secrets, debug leftovers, stale plan or README lines)

A card with only a pass/fail line stays In Progress. Update section 7 of `.cursor/skills/tdd-plan-implementer/SKILL.md`.

Done when that section names the three parts and says Done is refused without them.

## 3. One dev server, UI on one agent

Non-UI slices may use separate git worktrees and branches. A slice with UI stays on the main checkout, with one dev server. Browser verification uses that app. Do not start a second server or assign a port per worktree.

Update `.cursor/skills/parallel-delivery/SKILL.md`. The worker brief for a UI slice names the main checkout and forbids a private dev server.

Done when the skill states that split and the brief fields above.
