# City Day: start here

City Day nudges people into a good day out in St. Petersburg, FL. Pick a feeling, reveal one place, go, tap "We're here," and pick again. This repo is the live product (`index.html`, deployed by GitHub Pages from `main` to https://jakeand3rson.github.io/city-day-test/), plus every issue and PR. `npm test` runs `qa-verify.mjs`. CI is `.github/workflows/qa.yml`.

## Read first

1. **The charter:** `docs/reviews/2026-10-direction.md` in this repo. It beats everything else, including tickets and this file. Also read `docs/build-rules.md` and `docs/ui.md` here. If one of those files is not in the repo yet, ask on the issue. Do not guess its contents.
2. [CONTRIBUTING.md](CONTRIBUTING.md) for the rules and the dev team roles, and [docs/SDLC.md](docs/SDLC.md) for the lifecycle, labels, and question protocol.

**Single repo:** `city-day-test` is the only maintained repo. All docs and code changes go here. The private `city-day` repo is archived, read-only reference that agents don't need.

## Product rules you never break

1. Never invent hours, weather, events, prices, reviews, or vibes. If it can't be verified from a source, say "unknown" or leave it out.
2. Every stop is verified open for the day it's planned for.
3. Mystery first for everyone: feel → reveal → go → "We're here," one place at a time. The list is only an escape hatch.
4. The deck is frozen in the `#play/` link. Old links must keep playing after every change.
5. No accounts, payments, analytics, or tracking unless a ticket explicitly says so.
6. The repo is public: no real names, phone numbers, emails, or anything about the owner's family or finances.
7. Some users don't drink. Alcohol is opt-in, never a default.

## Who's who

- **Jake** (`Jakeand3rson`) is the Product Owner. He play-tests on his phone and is the only one who merges.
- **The PM (Adventure Planner)** writes tickets, answers questions, and reviews PRs. Its comments start with "PM (Adventure Planner):" and post under `Jakeand3rson`. Any other comment from that account is Jake.
- **The dev team** is the roles in `.claude/agents/`. Run the main session as the Engineering Manager with `claude --agent engineering-manager`.

## Naming

- Branches: `feat|fix|chore|data|spike/<issue#>-short-slug`, e.g. `fix/8-shellfish-allergy`.
- Commits: short, imperative, with the issue: `Block seafood on shellfish allergy notes (#8)`.
- PR title: plain English plus the issue: `Allergy notes block seafood (#8)`.
- PR body: the template, filled in completely. `Closes #N` on the first line. One issue per PR.
- Starting a ticket: comment `Starting: <role>, branch <name>`.

## The flow

1. Pick only `status:ready` issues, P0 first, oldest first. Check that no open PR already covers it. Claim it: swap `status:ready` for `status:in-progress` and keep one status comment current (who has it, the branch, a checklist). Other dev teams may be working in this repo too. See [Claiming a ticket](docs/SDLC.md#claiming-a-ticket).
2. Plan: the Tech Lead posts a plan for `size:L`, `type:spike`, or anything touching the play loop, the share-link format, or the catalog schema.
3. Build on the ticket's branch.
4. Test: checks in `qa-verify.mjs`, `npm test` and CI green, screenshots at 390×844.
5. Review: Code Reviewer, UX & Accessibility, Security & Privacy (plus the Tech Lead if it wrote a plan).
6. Open the PR. Never merge it, and never push to `main`.
7. The PM reviews it. Fix `needs:changes` on the same branch.
8. Jake play-tests and merges.
9. DevOps confirms the deploy.

Blocked on a product question? Comment `Question for PM:` with options and a recommendation, add `needs:pm-answer`, and move on to other ready work. Don't guess.

At the end of a session, comment on each ticket you touched: what was done, what's next, and any open questions.
