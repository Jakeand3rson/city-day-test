Closes #

## What changed

<!-- Plain English, one line per change. What a player or creator will notice. -->

## Acceptance criteria proof

<!-- Required. One row per acceptance criterion in the linked issue, in the issue's order. Proof is one of:
     - an automated check in qa-verify.mjs that passes in CI (give its exact name)
     - a 390×844 screenshot (link it below)
     - a source URL, for catalog data
     Status is Met or Not met. Explain any "Not met" under the table. A PR without this table gets `needs:changes`.
     If the PR touches the play flow or the share format, keep the old-links row. -->

| Criterion | Proof type | Proof | Status |
|---|---|---|---|
| Example: a past date is refused | Automated check | `form: a past date and a half-filled fixed point are refused` | Met |
| Old `#play/` links still play | Automated check | `standard: old #play/ links still play (open, reveal, We're here)` | |

## How tested

- **`npm test`:** <!-- e.g. "92 passed, 0 failed". Name the checks you added. -->
- **Phone size (390×844):** <!-- What you played through by hand. -->
- **Screenshots:** <!-- Before/after for anything visible. Crop out anything personal. -->

## Direction-doc check

<!-- Which rule or decision in docs/reviews/2026-10-direction.md (this repo) this follows, e.g. "§0 decision 6: free window is today through 3 days out". -->

## Checklist

- [ ] No invented hours, weather, or events. Anything unverified says so plainly.
- [ ] Old `#play/` links still play (new link fields are optional).
- [ ] No personal info (names, phone numbers, emails) added to this public repo, including in tests and screenshots.
- [ ] The mystery-first loop (feel → reveal → go → "We're here") is untouched, unless the issue says to change it.
- [ ] One issue, small diff. I didn't merge this myself.
