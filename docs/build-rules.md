# Build rules

## Before building

_Removed for the public repo (owner-private)._

## Feedback: "not for us"

If a stop isn't good, one tap says "not for us" and skips it.

On a paid day, that choice shows up on the end-of-day report.

No survey, no star rating, and no comment box in v1.

## Escape hatch: "just show me"

Some people get tired of the game. "Just show me" opens a short list of what's around.

- Mystery (or the wandering cards) stays the front door.
- The list is the way out, not the home screen.
- Free and paid both get it.

## How we craft a day

A pocket, not a schedule.

A few places worth walking to, then room to stumble on things.

- Never a minute-by-minute itinerary.
- Never a scraped dump of every business nearby.

## How a spot gets in

We only list a place after checking it's still open that day. We check the shop's own site or its hours on a maps listing.

The first city is St. Petersburg / Sarasota, the day we already walked and checked.

We don't fill a new city from a ratings scrape and hope for the best.

Quality means open, specific, and fits the mood. It does not mean the highest star count.

## Ease

- One idea per screen.
- One primary button.
- The list is the way out.

If a screen needs a paragraph of explanation, the screen is wrong.

## Architecture

**Phase 1 (free page):** a static web page, same shape as the Saturday page. One HTML page, moods, and directions links. No account, no database, no payments.

**Phase 2 (paid):** adds these pieces:

- Sign-in
- Stripe checkout
- A saved day that doesn't reset
- Sharing with the people on the day
- The end-of-day report

This doc doesn't design the phase 2 setup beyond naming those pieces. Where phase 2 is hosted and which sign-in provider we use are both still unknown.
