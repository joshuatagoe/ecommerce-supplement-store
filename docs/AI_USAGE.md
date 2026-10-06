# AI usage log

How AI was used on this project: tools, what worked, where it misled us, and how we corrected course. Entries are dated and are added in the same commit as the work they describe.

## Tools

- **Claude Code** in VS Code. It started on Opus 4.8 and was switched to Opus 5.5 partway through the 2026-10-05 session.
- **Plan mode** for the problem-space discussion. Nothing was written to the repo until the plan was approved.
- **Explore subagents** for web research, run in parallel with WebSearch and WebFetch. Each finding was labeled CONFIRMED (primary source), SECONDARY, or UNCONFIRMED.
- **Repo harness skills** in `.cursor/skills/`, including `grill` before every commit.
- **Notion** as the status board.

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
