# Contributing to City Day

For the dev team: humans and AI coding agents alike. The full lifecycle is in [docs/SDLC.md](docs/SDLC.md).

## Before you start

1. **Read the charter first:** `docs/reviews/2026-10-direction.md` in the private [city-day](https://github.com/Jakeand3rson/city-day) repo, plus `docs/build-rules.md` and `docs/ui.md` there. Where anything disagrees with the charter, the charter wins. If you can't read that repo, ask on the issue.
2. **Only pick up issues labeled `status:ready`.** `status:needs-decision` means Jake and the PM are still deciding. Don't build it.
3. **Check for an open PR** that already covers the issue. If one exists, don't duplicate it.
4. **Comment on the issue when you start** ("Picking this up") and assign yourself if you can.
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
6. CI (`npm test`) must be green.
7. Wait for PM review and Jake's play-test. **Jake merges.**

## Rules

- **One issue per PR.** If you find something else, file or mention a new issue. Don't fold it in.
- **Never push to `main`.** Everything goes through a PR.
- **Never merge your own PR.** Jake merges after he play-tests on his phone.
- **Keep PRs small.** A reviewer should be able to read the diff in one sitting.
- **Never invent hours, weather, or events.** If it can't be checked, say so plainly.
- **Don't break old `#play/` links.** New link fields must be optional.
- **This repo is public.** No names, phone numbers, emails, or personal details in code, tests, screenshots, or commits.
- **Don't change the mystery-first loop** (feel → reveal → go → "We're here") unless the issue says to.
