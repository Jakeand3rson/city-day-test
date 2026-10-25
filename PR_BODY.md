Closes #54

## Claim

Starting: Engineering Manager, branch cursor/54-entitlements-d36f
Team: cursor-dd4b
Claimed: 2026-10-25T22:43:20Z
Built after the PM answers on 2026-10-25. Issue comments and PR creation are not available on this token. This file is the claim.

## What changed

- One entitlement map in `entitlements.js`. A free record and a missing record deny shuffle, reroll, saving a day, deep filters, and a city that is not already `free`. A paid record allows those named actions. Anything else is denied. If the record cannot be read, paid actions are denied and the day still plays.
- The static page always calls the check with no record. Shuffle, "Not this. Try again," "Save this day," and "Request a city" stay visible and locked, with an upgrade hint and no price. Deep filters have no control.
- A city marked `basic` or `deep` still loads and still plays from a link. It is not offered on the free picker. A city with no status keeps today's picker.
- The brief and the generated day for a `free` city are unchanged. The in-progress day still stays on the phone so the link and the desk work. Keeping a day on the server is the locked action.
- Charter decision 3 and section 12 now match this split.

## Acceptance criteria proof

| Criterion | Proof type | Proof | Status |
|---|---|---|---|
| Entitlement map documented in one config/module, covered by unit tests | Automated check | `entitlement: a free or missing record is denied the paid actions, and a paid record allows only the named ones` | Met |
| Free user cannot use deep filters, rerolls, saved days or new-city requests (server rejects, test proves it) | Automated check | The same check, plus `entitlement: a free city still builds the same day, and shuffle and reroll stay locked` | Met |
| Locked controls are visible with an upgrade hint; screenshot at 390px and 1280px | Screenshot | `docs/screens/54-shuffle-390.png`, `54-shuffle-1280.png`, `54-reroll-390.png`, `54-reroll-1280.png`, `54-save-390.png`, `54-save-1280.png`, `54-request-control-390.png`, `54-request-control-1280.png` | Met |
| Existing free flow for current cities still works unchanged (regression test) | Automated check | `entitlement: a free city still builds the same day, and shuffle and reroll stay locked` and the rest of `npm test` | Met |

The regression Jake clarified: the generated day and the brief stay. Shuffle and reroll are the locked change, and the other gated actions are locked too. Deep filters are named and rejected, with no new controls.

## How tested

- **`npm test`:** 194 passed, 0 failed.
- **Phone size (390×844) and 1280×800:** Played a day in Chromium. Shuffle, Not this, Save this day, and Request a city are on screen, locked, with the hint. No page errors.
- **Screenshots:** The eight files named above. Names in the form are A and B.

## Direction-doc check

Charter decision 3 and section 12, updated in this branch to Jake's 2026-10-25 call. Decision 10 (pool size) is unchanged. No new commercial figures. Anything of that kind stays to verify, outside this repo.

## Overlap

No open pull requests. #69 and #70 are already on main. This branch starts from that main.

## Roles and models

Mode B. Included-usage models only. No fallback. Team cursor-dd4b.

| Role | Configured pin | Ran | Result |
|---|---|---|---|
| Engineering Manager | composer-2.5 | grok-4.7 (this session) | Claimed, then built after the answers |
| Tech Lead | grok-4.7 xhigh | grok-4.7-xhigh | Plan gate fail, then pass after the six corrections |
| Developer | grok-4.7 high | grok-4.7 (this session) | Module, locks, charter, checks |
| Code Reviewer | composer-2.5 | composer-2.5 | First merge gate fail: files were still uncommitted, and the first reroll shots did not show the button. Both fixed before push |
| QA | composer-2.5 | composer-2.5 | Pass. 194 passed, 0 failed |
| UX | composer-2.5 | composer-2.5 | Reroll shots recaptured so the locked button is in frame. Other controls passed |
| Security & Privacy | composer-2.5 | composer-2.5 | Pass |

Plan gate: pass (ran grok-4.7-xhigh, Cursor Models, Mode B), after a fail that named the corrections. Merge gate: the first run failed for the two reasons above (ran composer-2.5, Cursor Models, different family from the developer). The fixes are in this commit.

## Trail

[Engineering Manager · grok-4.7] started
[Engineering Manager · grok-4.7] finished — stopped for three questions, then continued after the PM answers
[Tech Lead · grok-4.7-xhigh] started
[Tech Lead · grok-4.7-xhigh] finished — plan gate fail, then plan gate pass
[Developer · grok-4.7] started
[Developer · grok-4.7] finished — entitlement module, locked controls, charter, checks
[Code Reviewer · composer-2.5] started
[Code Reviewer · composer-2.5] finished — merge gate fail on uncommitted files and the first reroll shots; both fixed before push
[QA · composer-2.5] started
[QA · composer-2.5] finished — pass, 194 passed, 0 failed
[UX · composer-2.5] started
[UX · composer-2.5] finished — reroll shots recaptured; other locked controls passed
[Security & Privacy · composer-2.5] started
[Security & Privacy · composer-2.5] finished — pass

## Checklist

- [x] No invented hours, weather, or events. Anything unverified says so plainly.
- [x] Old `#play/` links still play (new link fields are optional).
- [x] No personal info (names, phone numbers, emails) added to this public repo, including in tests and screenshots.
- [x] The mystery-first loop (feel → reveal → go → "We're here") is untouched, unless the issue says to change it.
- [x] One issue, small diff. I didn't merge this myself.
