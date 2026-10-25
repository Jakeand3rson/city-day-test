Closes #54

## Claim

Starting: Engineering Manager, branch cursor/54-entitlements-d36f
Team: cursor-dd4b
Claimed: 2026-10-25T22:43:20Z
Checklist: read the issue and the charter, stopped before a plan gate. No build. Needs an owner answer.

Issue comments and PR creation are not available on this token. This file is the claim.

## Question for PM

#54 is ready, and Jake approved Option A. Three choices in the ticket still change the product, and the charter disagrees with the ticket on what free keeps. I did not build, so I would not be guessing.

**1. What is a free user still allowed to do?**

The charter (decision 3 and section 12) says free and paid run the same day. Paid buys time and memory: planning further out, a report that is kept, "Surprise us too," and calendar nudges. Shuffle, the brief, and "Our day so far" stay free. The friends test is that same day, with no account.

The ticket says free is processed cities and basic preferences only, and paid adds any new city, deep filters, rerolls, saved days.

- Option A: Follow the charter. The entitlement check gates planning past the free window, a report kept on the server, "Surprise us too," calendar nudges, and requesting a city that is not already `free` in the catalog. Shuffle and the current brief stay unlocked. Deep filters wait for #18 and #19.
- Option B: Follow the ticket. Free cannot reroll, cannot keep a saved day, cannot use deep filters, and cannot request a new city. The current brief for cities already marked `free` stays.
- Recommendation: Option A. The charter beats the ticket, and the ticket also says the current free flow for current cities must keep working unchanged. Locking Shuffle or the phone's current day would change that flow.

**2. Do we show deep-filter controls before #18 and #19?**

Those two tickets are still `status:needs-decision`. The ticket says deep filters rely on them.

- Option A: The entitlement map names deep filters, and a free record is rejected. No new controls on the page until Jake decides #18 and #19.
- Option B: Add locked controls now for noise, kid-friendly, and music taste, with an upgrade hint and no matching behind them.
- Recommendation: Option A. The controls would be a guess about tickets Jake has not decided.

**3. How does the server tell free from paid, with no account and no payment provider?**

Payment processing is out of scope. The product has no sign-in. Option A (the hosting shape) can read an allow-or-deny record. It does not say who writes that record.

- Option A: The check is a function of a record (`free` or `paid`). This static site stays `free`. If the check cannot be reached, paid actions stay denied and the current day still plays. No sign-in and no provider in this change. Commercial terms stay to verify, outside this repo.
- Option B: Build sign-in in this ticket so the record belongs to a person.
- Recommendation: Option A. Sign-in and the provider are separate decisions. The tests can still prove a free record is rejected.

Please add `needs:pm-answer`. I will build after these three are answered.

## What changed

Nothing in the product. This file records the stop.

## Acceptance criteria proof

| Criterion | Proof type | Proof | Status |
|---|---|---|---|
| Entitlement map documented in one config/module, covered by unit tests | Not built | Waiting on the three questions above | Not met |
| Free user cannot use deep filters, rerolls, saved days or new-city requests (server rejects, test proves it) | Not built | Waiting on questions 1 and 3. Rerolls and saved days are not defined against Shuffle and the phone's current day | Not met |
| Locked controls are visible with an upgrade hint; screenshot at 390px and 1280px | Not built | Waiting on questions 1 and 2. No UI change, so no screenshot | Not met |
| Existing free flow for current cities still works unchanged (regression test) | Not built | No product change. The current suite on main was not re-run for a new check | Not met |

## How tested

- **`npm test`:** Not run. No product change.
- **Phone size (390×844):** No UI change.
- **Screenshots:** None.

## Direction-doc check

Charter decision 3 and section 12 (free and paid run the same day; paid buys time and memory) and decision 8 ("Surprise us too" and calendar nudges are paid only). Decision 10 is the pool size and is not part of this stop. Public repo: no commercial figures here. Anything of that kind is to verify.

## Overlap

No open pull requests. #69 and #70 are on main. This branch is main plus this file. It does not edit `docs/backend-hosting.md` or the city status files.

## Roles and models

Mode B. Included-usage models only. No role was launched above the stop. Team cursor-dd4b.

| Role | Configured pin | Ran | Result |
|---|---|---|---|
| Engineering Manager | composer-2.5 | grok-4.7 (this session) | Stopped for the three questions. No override for a build. |
| Developer | grok-4.7 high | not started | |
| Code Reviewer | composer-2.5 | not started | |
| QA | composer-2.5 | not started | |
| UX | composer-2.5 | not started | UI not started |

## Trail

[Engineering Manager · grok-4.7] started
[Engineering Manager · grok-4.7] finished — stopped before the plan gate. Three questions for the PM are above. Developer, Code Reviewer, QA, and UX did not start.

## Checklist

- [x] No invented hours, weather, or events. Anything unverified says so plainly.
- [x] Old `#play/` links still play (new link fields are optional).
- [x] No personal info (names, phone numbers, emails) added to this public repo, including in tests and screenshots.
- [x] The mystery-first loop (feel → reveal → go → "We're here") is untouched, unless the issue says to change it.
- [x] One issue, small diff. I didn't merge this myself.
