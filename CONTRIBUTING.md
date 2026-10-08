# Contributing to City Day

For the dev team: humans and AI coding agents alike. The full lifecycle is in [docs/SDLC.md](docs/SDLC.md).

## Before you start

1. **Read the charter first:** `docs/reviews/2026-10-direction.md` in the private [city-day](https://github.com/Jakeand3rson/city-day) repo, plus `docs/build-rules.md` and `docs/ui.md` there. Where anything disagrees with the charter, the charter wins. If you can't read that repo, ask on the issue.
2. **Only pick up issues labeled `status:ready`.** `status:needs-decision` means Jake and the PM are still deciding. Don't build it.
3. **Check for an open PR** that already covers the issue. If one exists, don't duplicate it.
4. **Claim it before you start.** Swap `status:ready` for `status:in-progress`, assign it, and post one status comment that says who has it (a team name or session ID, since every team posts as the same account), the branch, and a short checklist. Edit that comment as you go. If you stop, put `status:ready` back. A claim with no update for 24 hours has lapsed. See [Claiming a ticket](docs/SDLC.md#claiming-a-ticket).
5. **Blocked on a product question?** Comment `Question for PM:` with two or three options and your recommendation, add `needs:pm-answer`, and work on something else. Don't guess on anything a player or creator will see. See [Questions](docs/SDLC.md#questions).

## Workflow

1. Branch off the latest `main`:
   - `feat/<issue#>-short-slug` for features, e.g. `feat/12-feedback-share`
   - `fix/<issue#>-short-slug` for bugs
   - `chore/<issue#>-short-slug` for cleanup
   - `data/<issue#>-short-slug` for catalog work
2. Build it. Keep the change small and limited to the issue.
3. Run `npm install && npm test`. Add checks to `qa-verify.mjs` for what you changed. All checks must pass.
4. Check it at phone size (390×844).
5. Open a PR against `main`, fill in the PR template, and put `Closes #N` at the top.
   - Fill in the **Acceptance criteria proof** table: one row per criterion in the issue, each with its proof. That's an automated check that passes in CI (by its exact name), a 390×844 screenshot, or a source link for catalog data. The PM marks a PR without it `needs:changes`.
   - If the PR touches the play flow or the share format, the standard proof is `standard: old #play/ links still play (open, reveal, We're here)` in `qa-verify.mjs`. Before you change the link format, add a link built by the current `main` to `OLD_LINKS` there.
6. CI (`npm test`) must be green.
7. Wait for PM review and Jake's play-test. **Jake merges.**

## Dev team roles

The dev team is a set of Claude Code subagents in [`.claude/agents/`](.claude/agents/). Each file says what the role does and which model it runs on. The cheapest model that still does the job well: `haiku` for mechanical checks, `sonnet` for most building and review, `opus` only where deep judgment pays.

| Role | Agent | Model | What it does |
|---|---|---|---|
| Engineering Manager | `engineering-manager` | sonnet | Runs the main session (`claude --agent engineering-manager`). Picks the next ready ticket, routes it, keeps one ticket per branch and PR, makes sure every step happens, and runs the question protocol. Doesn't write product code. |
| Tech Lead / Architect | `tech-lead` | opus | Posts a short plan on the issue for every `size:L`, `type:spike`, or change to the play loop, the share-link format, or the catalog schema. Does the final review on those PRs. |
| Developer | `developer` | sonnet | Builds the ticket on its branch. Small, readable changes in the existing style and voice. |
| QA Engineer | `qa-engineer` | sonnet | Turns each acceptance criterion into a check or a 390×844 Playwright script, regression-tests old `#play/` links, tries edge cases, and attaches screenshots. |
| Code Reviewer | `code-reviewer` | sonnet | Reviews correctness, simplicity, and regressions before the PM sees the PR. Escalates to the Tech Lead when unsure. |
| UX & Accessibility Reviewer | `ux-accessibility-reviewer` | sonnet | Checks 44px tap targets, WCAG AA contrast, plain product-voice copy, and one-handed use. |
| Data & Catalog Researcher | `data-catalog-researcher` | sonnet | Does `type:data` and `area:catalog` work from official sources only, with a source and checked date for every fact. |
| Security & Privacy Reviewer | `security-privacy-reviewer` | haiku | Scans every diff for personal info, secrets, tracking, and copied third-party content. Blocks the PR if it finds any. |
| DevOps / Release | `devops-release` | haiku | Keeps CI green. After Jake merges, confirms Pages serves the new commit and comments on the PR. |
| Tech Writer | `tech-writer` | haiku | Writes PR descriptions and keeps this file and `docs/SDLC.md` current, in plain English. |

When a role starts a ticket, it comments `Starting: <role>, branch <name>` on the issue.

### Questions for the PM

If something blocks the acceptance criteria (an ambiguity, a conflict with the charter, a missing decision, or a real tradeoff):

1. Comment on the issue, or on the PR if it's about the PR. Start with **`Question for PM:`**, ask one clear question, list the options, and recommend one with your reasoning.
2. Add the label **`needs:pm-answer`**.
3. Don't guess, and don't stop. Work on another `status:ready` ticket.
4. The PM answers with a comment starting "PM (Adventure Planner):" and removes the label. If Jake has to decide, the PM switches it to **`needs:owner-answer`**. Wait for that answer.
5. When the label is gone and there's an answer, pick the ticket back up and follow the answer exactly.

Comments from `Jakeand3rson` that start with "PM (Adventure Planner):" are the PM. Any other comment from that account is Jake.

## Rules

- **One issue per PR.** If you find something else, file or mention a new issue. Don't fold it in.
- **Never push to `main`.** Everything goes through a PR.
- **Never merge your own PR.** Jake merges after he play-tests on his phone.
- **Keep PRs small.** A reviewer should be able to read the diff in one sitting.
- **Never invent hours, weather, or events.** If it can't be checked, say so plainly.
- **Don't break old `#play/` links.** New link fields must be optional.
- **This repo is public.** No names, phone numbers, emails, or personal details in code, tests, screenshots, or commits.
- **Don't change the mystery-first loop** (feel → reveal → go → "We're here") unless the issue says to.
