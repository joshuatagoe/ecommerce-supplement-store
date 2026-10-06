# AI usage log

How AI was used on this project: tools, what worked, where it misled us, and how we corrected course. Entries are dated and are added in the same commit as the work they describe.

## Tools

- **Claude Code** in VS Code. It started on Opus 4.8 and was switched to Opus 5.5 partway through the 2026-10-05 session.
- **Plan mode** for the problem-space discussion. Nothing was written to the repo until the plan was approved.
- **Explore subagents** for web research, run in parallel with WebSearch and WebFetch. Each finding was labeled CONFIRMED (primary source), SECONDARY, or UNCONFIRMED.
- **Repo harness skills** in `.cursor/skills/`, including `grill` before every commit.
- **Notion** as the status board.
- **General-purpose research subagents** (2026-10-06) for scale, traffic timing, US market size, visual design guidance, and hosting. Each ran in the background and used the same confidence labels.
- **The `plan-creator` skill** to shape the architecture.
- **A private preview page** (a Claude artifact) comparing the candidate palettes. A copy is in [design/palettes.html](design/palettes.html).
- **Small Python and Node scripts** to check claims instead of asserting them: money examples, contrast ratios, colour-blindness differences, and diagram alignment.

## 2026-10-05 — Problem space

### What worked

- **Research subagents instead of answers from memory.** Parallel agents with confidence labels replaced the AI's general knowledge with sourced facts. These facts changed the design:
  - Fullscript's no-profit default
  - Fullscript's 35% pricing band
  - "Wholesale" means practitioner pricing, not buying in bulk
  - Fullscript's wholesale service doesn't ship to patients
  - BLS wage data for practice staff
- **Worked dollar examples.** Once the user asked for plain language, every pricing point was explained with one $40 bottle. That made the money model easy to check.
- **Tracking open questions and asking them once at the end.** This replaced decision prompts during the discussion, which hadn't been working (item 3 below).

### Where AI misled us or we course-corrected

1. **The AI invented a separate "supplier" party in the money split.** The user asked who that was. Correction: we hold the inventory, so we are the supplier.
2. **The AI asked an unclear "three-leg vs four-leg split" question.** It restated it in plain terms, then dropped it as not needed for the slice.
3. **The AI pushed multiple-choice decision prompts before the problem was understood.** The user rejected three of them. New rule: discuss first, keep a list of open questions, and ask them all at the end.
4. **The AI built pricing around an invented "base price" with a platform markup.** It was working from a partial PRD. The full PRD defines the split as COGS + provider margin + fee, which removed the markup. Lesson: get the full PRD before modelling money.
5. **The AI wrote "60% of retail", which read as "60% off".** It switched to dollar amounts.
6. **The AI said Fullscript "won't ship to patients at all".** That is only true of its wholesale service; its patient store does ship to patients.
7. **The AI said moved volume couldn't be measured.** The user pointed out that every order placed with us can count as moved, since the PRD says the volume already exists. Adopted as D8.
8. **The AI read "update inventory" as stock counts.** The user clarified that it means the provider's list of items they sell. Adopted as D7.
9. **Research sources contradicted each other on Emerson's drop-ship fee.** The finding was kept as UNCONFIRMED rather than picking one source.
10. **The AI first recommended fictional demo brands to avoid licensing risk.** The user weighed realism higher. We settled on real names with our own images (D15).

## 2026-10-06 — Saving the problem space

### Where AI misled us or we course-corrected

11. **The AI saved the agreed problem space as a new `docs/ARCHITECTURE.md`.** It followed AGENTS.md's rule that the plan lives there. But the session wasn't meant to start the architecture, and the file took the name the architecture session should create from scratch. The user caught it after the commit. Correction: renamed to `docs/PROBLEM_SPACE.md`, and `ARCHITECTURE.md` is left for the architecture step. Lesson: put a phase's output in a file named for that phase, and flag any plan step that touches the next phase's files before the plan is approved.

## 2026-10-06 — Architecture

### What worked

- **Research before deciding.** Five parallel research agents changed decisions:
  - **Scale:** the target came from Fullscript's published numbers (about 20k orders a day, 10M requests a day on one Rails app), not a guess.
  - **Hosting:** the research showed which free tiers break which requirement.
  - **Design:** fonts and palettes came from public design systems.
- **Computing instead of asserting:**
  - Scripts checked every money example under the round-up rule ($20.00 → $20.16 lowest price, 2 × $36.10 → 56¢ fee).
  - The preview page computes its own contrast ratios and colour-blindness differences.
  - The colour-blindness check reversed a palette recommendation.
- **A visual preview** let the user judge palettes on a mock pay page and portal instead of from hex codes.
- **Holding open questions and asking them in one batch** kept the discussion moving.
- **The user's own ideas improved the design:**
  - SSE for the confirming page.
  - Signed pay links ("if we double click, don't we hash both and get the same result?").
  - One Sales list with Order again.
  - Quantity per line.
  - Local checks before every push, like an eval set.
  - Keeping the load tests to show scale was thought through.
  - Asking for screen-reader, keyboard and high-contrast support.

### What didn't go as expected

- **Remote push addresses.** The user assumed every push went to both GitHub and GitLab. A `git branch -vv` check showed every push had gone only to GitHub. Adding GitLab as a second push address was blocked by Claude Code's permission check (it treats repointing a remote as risky). The user chose explicit pushes to each remote instead.

### Where AI misled us or we course-corrected

12. **The AI put an invented fact in a research prompt.** It asked the research agent to verify a "2022 Snowflake/Hambro" Fullscript funding round. No such round exists; the 2021 round was led by HGGC and Snapdragon. Lesson: research prompts ask open questions and don't plant "facts" to confirm.
13. **The AI proposed a 500 ms response-time target with no source.** The user asked why 500 ms. Sources found afterwards supported it: NN/g's 1-second limit, web.dev's 800 ms "good" time to first byte, and Lighthouse's 600 ms. The doc now states the reasoning.
14. **The AI changed its mind twice on storing pay-link tokens.** It proposed hashing them. It then said hashing meant "we could never show the link again" and reversed. The user questioned that, and it was a trade-off, not a blocker. The user's intuition led to signed links, which keep the benefits of both. Lesson: present trade-offs as trade-offs.
15. **The AI said the "approved, then our save fails" case couldn't be demoed.** The user asked why. A slow-approve test card, plus stopping the local database during its pause, shows the real failure without a "break the code" switch.
16. **The AI framed login as "cookie versus token".** The user pointed out JWT. JWT is a token format and a cookie is where it's kept, so the design uses a JWT inside an HttpOnly cookie.
17. **The AI turned the user's "recent orders" request into separate Orders and Sales pages.** The user reconsidered, and they became one list with Order again.
18. **A research agent recommended palette C on looks alone.** The user asked what evidence supported it. The AI found none beyond taste, ran a colour-blindness check that favoured A, and the user chose A, which they had preferred on sight.
19. **The AI argued against Next.js with an outdated caching claim** and overstated the difficulty of SSE. Checking the docs showed Next.js 16 made caching opt-in. The user knows Next.js, so it was chosen. The one real wrinkle (sharing memory with the startup hook) is avoided with Postgres LISTEN/NOTIFY.
20. **The AI applied production standards to demo hosting** and recommended $13.30 a month. The user asked whether a sleeping free server really mattered for a demo. It doesn't, as long as the sweep also runs at server start. Hosting is now $0, with the paid setup recorded for production.

## 2026-10-06 — Workflow before implementation

### What worked

- **Reading the past workflow reports first.** Both pointed to due-date surprises, which led to deploying at M0 (D40).
- **A docs research agent** checked current Claude Code features (permissions, hooks, worktrees, skill discovery) instead of the AI answering from memory.

### What didn't go as expected

- **The project skills weren't being loaded.** Claude Code only finds skills in `.claude/skills/`, and this repo kept them in `.cursor/skills/`. They were followed only because AGENTS.md names them. They are now copied (D41).

### Where AI misled us or we course-corrected

21. **The docs research agent suggested allowing `Bash(npm run *)`.** That rule would also have run `npm run push`, which pushes to both remotes, without asking. It was caught before anything was added. The AI then proposed a deny rule for pushes, which would also have blocked pushes the user approved. Pushes go in an ask rule, which prompts every time.
22. **The same agent suggested a hook that runs tests after every edit.** In test-first work the new test fails on purpose, so the hook would mostly report expected failures. It was dropped.

## 2026-10-06 — M0 skeleton

### What worked

- **Test first, with a deliberate break.** Each health-check case failed before the code existed. The noindex and robots tests were checked by breaking the header and the robots rule on purpose: all three tests failed, then passed once restored.
- **A clean-clone run.** Copying exactly the files a clone gets into an empty folder showed that `npm run setup` works from scratch (34 s) and that `verify` passes there.

### Where AI misled us or we course-corrected

23. **The AI said today's harness commit was on `docs/problem-space`.** It was on `main`. The AI trusted the git status shown at the start of the session, which was stale, and didn't check the branch before committing. Nothing was pushed. Lesson: run `git branch --show-current` before every commit.
24. **The AI wrote the placeholder page, `robots.txt` and the noindex header before running their end-to-end test,** so it never saw those tests fail first. It caught this itself and made up for it by breaking each part on purpose and watching the tests fail.
25. **Neon's onboarding offered a CLI setup (`neon deploy`, `neon skills`, `neon mcp`).** It would have deployed the app to Neon and added unreviewed skills and an MCP server to the repo. It was skipped, because Neon is only the database here and the app runs on Render (D34).
