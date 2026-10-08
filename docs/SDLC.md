# How City Day gets built

This is the lifecycle for every change to City Day, from an idea to the live site.

**Who's who**

- **Jake** owns the product. He decides with the PM, play-tests on his phone, and is the only person who merges.
- **The PM** turns decisions into GitHub issues, reviews PRs against the issue and the charter, and checks the live site after a merge.
- **The dev team** picks up ready issues and opens PRs. Right now that's AI coding agents (Claude Code; maybe Grok Build later), and possibly humans.

**Where things live**

- **Issues, PRs, and code:** this repo, [city-day-test](https://github.com/Jakeand3rson/city-day-test). It's public, and GitHub Pages deploys `main` to https://jakeand3rson.github.io/city-day-test/.
- **Product docs and decisions:** the private [city-day](https://github.com/Jakeand3rson/city-day) repo. The charter, `docs/reviews/2026-10-direction.md`, wins over everything else. Docs-only work is still filed here, labeled `area:docs`, and the PR goes to city-day.

---

## The lifecycle

### 1. Idea

Jake and the PM talk it through: what's the problem, who it's for, and does it fit the charter? Nothing gets filed until they both think it's worth doing.

### 2. Ticket

The PM files an issue using a template (Feature, Bug, or Catalog place) and sets:

- a **type**, **priority**, **size**, and **area** label
- the **milestone**, if it's part of one (e.g. `v1: Friends test`). `Later (post-v1)` is parked: don't pick it up until Jake moves the issue to `v1: Friends test` and `status:ready`.
- a **status**: `status:needs-decision` while anything is still open; `status:ready` once the acceptance criteria are final

Blank issues are turned off, so every issue has the same shape.

### 3. Pick up

The dev picks up a `status:ready` issue. Either they assign themselves, or Jake hands the issue link to an agent like Claude Code. The dev:

- comments on the issue ("Picking this up")
- creates a branch: `feat/<issue#>-slug`, `fix/<issue#>-slug`, `chore/<issue#>-slug`, or `data/<issue#>-slug`
- moves the card to **In progress** (once the project board exists)

### 4. Build + PR

The dev builds the change, adds checks to `qa-verify.mjs`, and opens a PR against `main` that:

- starts with `Closes #N`, so merging closes the issue
- fills in the PR template: what changed, how it was tested (the `npm test` result, a 390×844 phone check, screenshots), the direction-doc check, and the checklist
- has green CI (the **QA** GitHub Action runs `npm test` on every PR)

The card moves to **In review**.

### 5. PM review

The PM reads the PR against the issue's acceptance criteria and the charter, and leaves a review comment with a proof table: one row per criterion, the proof, and a status (Met, Not convincing, or Missing). The PM doesn't merge.

- If any row isn't Met, the PM adds `needs:changes`. The dev pushes fixes to the same branch and removes the label when done.
- Every row Met means "approved for play-test".

### 6. Play-test

Jake opens the change on his phone and plays a real day with it. If something feels off, he comments on the PR and it goes back to step 4.

### 7. Merge

Jake merges the PR. GitHub Pages deploys `main` within a few minutes, and the linked issue closes automatically.

### 8. Verify

The PM checks the live site, at phone size, against the acceptance criteria. If it holds, the card moves to **Done**. If not, the PM reopens the issue or files a new bug that links to the PR.

---

## Questions

If you're blocked on a product question, don't guess on anything a player or creator will see.

1. Comment on the issue (or the PR, if it's about the PR). Start with `Question for PM:`, then the question, two or three options, and the one you recommend and why.
2. Add `needs:pm-answer`.
3. Move on to other `status:ready` work.

The PM answers within about an hour during the day, with a comment starting "PM (Adventure Planner):", and removes the label. When Jake has to decide, the PM relabels it `needs:owner-answer` and replies once he has. Pick the ticket back up when the label is gone, and follow the answer exactly.

---

## Definition of Ready

An issue can be labeled `status:ready` when:

- [ ] Jake and the PM have agreed on it
- [ ] The problem and who it's for are stated
- [ ] The acceptance criteria are a testable checklist, with nothing left as "TBD"
- [ ] Out of scope is written down
- [ ] It names the charter rule it follows
- [ ] It has type, priority, size, and area labels
- [ ] It's small enough for one PR (`size:L` issues should be split if they can be)

## Definition of Done

An issue is done when:

- [ ] Every acceptance criterion is met
- [ ] `npm test` passes in CI, with new checks for the change
- [ ] The PM has reviewed it
- [ ] Jake has play-tested it on his phone and merged it
- [ ] It's live on GitHub Pages and the PM has checked it there
- [ ] Old `#play/` links still play
- [ ] Nothing invented (hours, weather, events), and no personal info added to the public repo

---

## Labels

### Type

| Label | Meaning |
|---|---|
| `type:feature` | New behavior or screen |
| `type:bug` | Something is broken, or behaves against the charter |
| `type:chore` | Cleanup, refactor, or copy fix with no new behavior |
| `type:data` | Catalog work: places, hours, closures, dated events. Needs a source, always. |
| `type:spike` | Research or a prototype. The output is a write-up or a proposal, not shipped code. |

### Priority

| Label | Meaning |
|---|---|
| `P0` | Broken, or blocks the friends test. Drop other work and use the hotfix path. |
| `P1` | Next up |
| `P2` | Later |

### Size

| Label | Meaning |
|---|---|
| `size:S` | About an hour or two. One focused change. |
| `size:M` | About half a day to a day. A few parts touched. |
| `size:L` | More than a day. Split it if you can. |

### Area

| Label | Meaning |
|---|---|
| `area:create` | The creator desk: brief, engine, deck, share link |
| `area:play` | The mystery walk: curtain, feelings, reveal, escapes, trail |
| `area:catalog` | Places, hours, tags, sources |
| `area:weather` | Forecast, "Sky looks iffy," weather fallbacks |
| `area:share` | Share links, link preview, icons, feedback to Jake |
| `area:docs` | Docs-only. The work happens in the private city-day repo. |
| `area:infra` | CI, Pages, tooling, agent tooling |

### Status

| Label | Meaning |
|---|---|
| `status:needs-decision` | Jake and the PM are still deciding. Don't build it. |
| `status:ready` | Fully specced. A dev can pick it up. |
| `status:blocked` | Waiting on something. The issue says what. |

### Needs

| Label | Meaning |
|---|---|
| `needs:pm-answer` | The dev asked the PM a question (see [Questions](#questions)). Work on something else until it's answered. |
| `needs:owner-answer` | The PM passed the question to Jake. Wait. |
| `needs:changes` | The PM's review found missing proof or required changes. The dev removes it after pushing the fixes. |

GitHub's default labels (`bug`, `enhancement`, and so on) are still there but aren't used. Use the labels above instead.

---

## Hotfix path (P0 bugs)

Same flow, just faster. Still a PR, and still never a push to `main`.

1. The PM (or Jake) files the bug with `P0` and `status:ready` right away, with the repro steps.
2. The dev branches `fix/<issue#>-slug` and makes the smallest change that fixes it, with a check in `qa-verify.mjs` that fails without the fix.
3. PR with `Closes #N` and green CI.
4. The PM review can be a quick comment. Jake play-tests just the broken path, then merges.
5. The PM checks the live site. Anything left over becomes a normal P1 issue.

---

## Board

The plan is a GitHub Project called "City Day" with these columns: **Backlog → Ready → In progress → In review → Done**. Until it exists, the labels and milestone carry the same information:

- Backlog = open issue, `status:needs-decision`
- Ready = `status:ready`, nobody assigned
- In progress = assigned, or the dev has commented that they're on it
- In review = open PR with `Closes #N`
- Done = closed issue, checked on the live site

---

## Guardrails

- Nothing is merged to `main` directly (charter §0, decision 9). Jake merges every PR.
- Never invent hours, weather, or events.
- Old `#play/` links keep working.
- No accounts, payments, analytics, or tracking until the charter says so.
- This repo is public: no names, phone numbers, emails, or personal details anywhere in it.
