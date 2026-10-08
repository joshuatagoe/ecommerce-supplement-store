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

## 2026-10-06 — M1 experiment setup (D43, D45)

### What worked

- **An exhaustive check before writing the Pricing contract.** A short Node script tried every price for 205 million price-and-cost pairs and found that the margin never rises by more than 1¢ per cent of price. That settled the margin-entry rule before any arm built it.
- **Testing the hidden referee before trusting it.** A reference M1 kept outside the repo was broken one rule at a time, 43 ways, and each break had to turn the referee test aimed at it red. One test stayed green because a different rule happened to refuse the same data; it was rewritten so only its own rule can refuse it.
- **Reproducing each test-setup bug before fixing it.** Two worktrees running the integration tests at the same moment failed 5 times out of 5 on the health test's shared scratch database. After the D45 fixes, the main checkout and two worktrees together passed 5 times out of 5.
- **A throwaway worktree agent that only reported where it ran.** It showed that Claude Code puts agent worktrees inside the repo (`.claude/worktrees/`), with no `.env` or `node_modules`, before any parallel arm hit that.

### Where AI misled us or we course-corrected

26. **The AI wrote a false trade-off into D5: "The margin can be 1¢ off what the provider typed."** It was written into DECISIONS.md during the problem-space session without a check, and carried into PROBLEM_SPACE.md and the §13 property test ("lands within 1¢"). Each extra cent of price adds 0¢ or 1¢ of margin, so every margin can be hit exactly. Found while writing the Pricing contract and confirmed by the exhaustive check above. All three places now say "exactly, at the lowest such price". Had it stayed, an arm following §13 could have shipped a price 1¢ off and passed its own tests.
27. **The AI proposed fixing the work split for the parallel arms in advance, and installing fast-check and zod for them.** The aim was to make arms 3 and 4 differ only in file sharing. The user pointed out that this defeats the experiment: in real use the AI splits the work and adds dependencies itself, so a hand-made split would measure a setup that won't exist later. Each arm's lead agent now decides its split, and the scoring records which split it chose. Only bugs in the test setup that every parallel run would hit once are fixed in advance (D45).
28. **The AI set the arms up to be run by hand:** one new session per arm, with the user pasting each prompt and answering each grill. The user expected them to run automatically, one after another, and also asked for a narrower, demanding benchmark. A test session showed that unattended runs (`claude -p`) handle worktree agents, Workflows and Notion, so a driver script now runs and scores the arms (D46).
29. **The AI wrote where the hidden referee lives into Claude Code memory,** which every new session in the repo loads, including the arm sessions. It caught this before any arm ran. The memory now says the location is withheld on purpose, and the driver refuses to start an arm if memory names it.

## 2026-10-06 — M1 money core (D43 arm 1, one agent)

### What worked

- **Breaking the code on purpose to test the tests.** Pricing was broken 16 ways, such as rounding the fee down, pricing a margin 1¢ high, or capping quantity at 10. The schema was broken 61 ways: each rule removed or loosened in the migration, with the test database rebuilt each time. Every break had to turn a test red. This found two gaps, both fixed (item 32 below). One break can't be caught: loosening the frozen-line margin bound to −1¢ changes nothing, because the money rule on the same column still refuses the row.
- **Tests that name the rule that refused.** Each refusal must be an integrity error (SQLSTATE class 23) that names the expected constraint or trigger. A test can't pass because a different rule happened to catch a broken fixture, which is how one of the setup session's referee tests had stayed green.
- **A property test across Pricing and Postgres.** 300 random lines, frozen from Pricing's split, are accepted exactly when `checkPrice` says ok, and a fee 1¢ off Pricing's is always refused. This shows the database's fee formula and the shared module agree.

### Where AI misled us or we course-corrected

30. **§7's rule table had CHECK expressions that pass on NULL.** The AI wrote them in the architecture session. A CHECK that comes out NULL lets the row through, so `frozen_at IS NULL OR unit_cost_cents + … = unit_price_cents` accepts a frozen line with no cost. Likewise, `(status = 'paid') = (paid_attempt_id IS NOT NULL AND paid_at IS NOT NULL)` accepts a sent order with a `paid_at` and no attempt. Found while writing the schema. Closed in D47, which waits for the user.
31. **drizzle-kit wrote the Sales indexes as `DESC NULLS LAST`.** In Postgres, §7's plain `DESC` means `NULLS FIRST`. Caught by reading the generated SQL instead of trusting it; the schema now asks for `NULLS FIRST` explicitly.
32. **The AI's first tests missed two cases, and the suite still passed.** No test refused a `link_version` of 0. The fractional-quantity test only threw because its results happened to be fractional, so a Pricing that skipped the quantity check still passed. Both were found by the deliberate breaks above, not by review. Lesson: a suite that passes on its first run proves little until each rule has been broken once.

## 2026-10-07 — D43 results, and closing M1's gaps

### What worked

- **A hidden referee that never saw an arm's code.** Every arm passed all 109 stated tests, and every arm still left two of §7's implied rules open. The referee found both, and both are now rules (D50).
- **A repeat run of the cheapest setup.** One agent scored the same both times (16 of 18 implied), so the gaps between setups aren't luck.
- **Testing each new mechanism in a small session before trusting a long run with it:**
  - a background session waking its lead
  - a Workflow inside a background session
  - resuming a stalled session

### Where AI misled us or we course-corrected

33. **The AI's first driver ran the arms with `claude -p`.** Its test session had a lead that waited for its agent, which hid the problem. Under `-p` a session ends when the lead's turn ends, and agents still working are cut off 10 minutes later. Arm 2's first run lost both agents' work that way. The arms were rerun as background sessions (`claude --bg`), which wake the lead when an agent reports back.
34. **The AI guessed that a Workflow permission prompt had stalled arm 3's first run.** Two test sessions showed that Workflows run without asking. The real cause, a session that made no further request after loading a guide, didn't happen again. The driver now restarts a quiet session up to twice and leaves the hung time out of the arm's time.
35. **A referee test timed out once while scoring arm 2.** That cost it two stated tests, and a rerun passed them. The scorer now reruns once when the only failures are infrastructure errors (a timeout, or the aborted transaction that follows one). A real bug fails again.
36. **The AI first resumed a stalled session with its launch flags, which starts a copy under a new ID.** A test caught it. Resuming with no flags wakes the same session, with its saved model, effort and permissions.

## 2026-10-07 — S1 contracts and M2 (sign in, My store)

### What worked

- **One grill for every remaining milestone, answered in one message.** The questions only the user could answer (the health fields, Add's starting price, test cards, seeding the live database, metrics, pace) were settled before any card was seeded. Routine choices went in as named assumptions.
- **A research subagent for the demo catalog.** It read each brand's own US product page and reported where it couldn't confirm a price, rather than estimating. Four brands' prices were confirmed. Four others were left out, because their sites block automated access or need a practitioner login.
- **Screenshots at phone width, not just tests.** The browser tests and axe passed, and a screenshot at 320px still found the page scrolling sideways (item 37).

### Where AI misled us or we course-corrected

37. **The AI's first My store page was 543px wide on a 320px phone.** A visually hidden column header inside the scrolling catalog table was positioned against the page instead of the table, so it pushed the page past the scroll region. All 13 browser tests and axe passed. A screenshot and a width measurement caught it; the table wrapper is now the hidden text's containing block, and a new test checks the width at 320px.
38. **The AI's first "Not saved" message showed in success green.** Caught on the same screenshots; the status now takes its colour from the outcome.

## 2026-10-07 — M3 (New order to Send)

### What worked

- **A scratch database for code that runs its own transactions.** Orders opens, locks and commits its own transactions, which the rolled-back tests from M1 can't hold. Each Orders test file gets a database of its own, so the double-Send race is real: twenty Sends at once on separate connections.
- **Breaking the code on purpose, again.** Removing the row lock, letting Cancel ignore a pending payment, and skipping Send's range check each turned exactly one test red.

### Where AI misled us or we course-corrected

39. **The AI's first patient picker never opened.** Search results arrived after the typing that should have opened the list, and React Aria doesn't open a closed list when its items change. The browser tests caught it; the list now opens as soon as typing starts and says "Searching…" until results come back.
40. **Next.js 16 logs every server action with its arguments in development,** so patient search text ("Sam") appeared in the dev server's terminal. That breaks §10's rule that search text never reaches a log. Found by reading the dev log while debugging item 39; `logging.serverFunctions` is now off.

## 2026-10-07 — M4 (Pay)

### What worked

- **One test per row of the §5 "breaks" table.** Each is a real transaction on a scratch database, with the stub's own file, and a test-only hook that makes the step 5 write fail after an approval. The 0101 and 0200 cards also run end to end in the browser, where the page updates itself over SSE when the sweep settles the payment.
- **Breaking the payment code on purpose.** A timeout shown as "declined", an expired link allowed to pay, and a sweep that charges instead of asking each turned tests red.
- **Repeating an intermittent failure until its cause showed.** An axe check failed once in two runs. Five repeats showed the same rule each time: no `<title>` (item 41).

### Where AI misled us or we course-corrected

41. **The AI's first axe checks ran before Next.js 16 had streamed the new page's `<title>`.** A dynamic page's title arrives after its content, so axe sometimes saw a page with no title. The checks now wait for the title. It's a test timing problem, not a page defect: the title is always there once the page settles.
42. **The AI's tests looked for one `role="alert"` and found two.** Next.js adds a route announcer with that role. The tests now look for the alert by its text.

## 2026-10-07 — M5 (Sales, Order details, reconcile, metrics)

### What worked

- **Building the reporting dataset through the real code with the clock set (D57).** A payment at 10pm Pacific on October 31 lands in October in the practice's Sales and in November in the UTC metrics, and both tests check it. Swapping the practice's time zone for UTC turned exactly those two tests red.

### Where AI misled us or we course-corrected

43. **The AI first put the helper that signs pay links in a `"use server"` file.** Every export of such a file can be called from the browser, so anyone signed in could have asked it to sign a link for any ref. Caught while writing the Sales page, before it ever ran; the helper now lives in a plain server module.
44. **The AI's browser tests asked for the "New order" link and found two.** Playwright matches names by substring, and the empty Sales page's "Start a new order" link matched too. The tests now ask for the exact name. One test also counted My store's Remove buttons before the page had loaded, so it removed nothing; it now waits for the page.

## 2026-10-07 — M6 (seed history and polish)

### What worked

- **Seeding history through the app's own code, with a fixed random seed.** The seed's 33 paid orders pass reconciliation, Dr. Patel's lines all earn exactly $0.00, and rebuilding gives the same history every time. A test checks each of those.
- **Checking the polish under a contrast theme.** Screenshots with forced colours on showed the pay page's tints disappearing as expected, with every pill, mark and control keeping its border. Two browser tests now emulate a contrast theme and run axe.

## 2026-10-07 — M8 (load tests and the outage drill)

### What worked

- **Driving the real app instead of adding test endpoints.** A short probe showed how Next.js 16 calls a server action (a POST with a `Next-Action` header) and how a form posts without JavaScript. That was enough for k6 to run every order through the same code a browser does.
- **Checking the money, not just the speed, after every run.** Even at Level 3, where a quarter of requests failed, reconciliation was clean and every charge was a recorded payment. A speed-only test couldn't have shown that.
- **Reading the server's log during a passing run.** Level 1 passed every threshold, but one "Connection terminated unexpectedly" in the log led to the missing pool error handler (D72), which the outage drill then proved.
- **Measuring before naming a bottleneck.** Per-step timings and CPU samples during Level 2 showed the app server at its one-core ceiling and Postgres at 40%. Without them, the pool or the stub's file would have been plausible guesses.

## 2026-10-07 — M9 (README, final logs, demo script)

### What worked

- **Checking the README's numbers instead of trusting them.** `npm run verify` now fails if the README's two test counts don't match a fresh run (D74), so the first thing graders read can't drift from the code.
- **Scripting the demo with the browser tests' selectors.** The video's steps run the same way every take, and a quick headless run (`DEMO_PAUSE=0 DEMO_HEADLESS=1`) checks the script still matches the app before recording (D75).

### Where AI misled us or we course-corrected

45. **The architecture doc, written with the AI before the build, described things that were never built.** It said every request gets a request ID, and it listed `sweep` and `verify:full` commands and a shared component kit (Money, LineEditor, DataTable and others) that the build never needed. The M9 sweep checked the doc against the code: request IDs are now marked planned and parked under Later, and the command list and component diagram name what exists.
46. **A property test the AI wrote in M1 used Vitest's default 5-second timeout.** It takes 2.5 s alone and over 5 s with the other database files running beside it, so verify failed once in M9. The integration tests now get 20 seconds (D77); the test itself is unchanged.

## 2026-10-08 — L1 (the fee on each line, and Max profit)

### Where AI misled us or we course-corrected

47. **The AI's pricing screens showed "You earn" without the fee it comes after.** Testing M4, the user read "You earn $15.73" at $36.00 as ignoring the 0.75% fee. The money was right, because the margin is what's left after the fee (D5), but nothing on the screen said so. Every place a price is set now shows the cost and fee under "You earn" (D78).
