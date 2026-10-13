# Adding a city

City Day reads each city from one file. A city is its config at the top of the file, then its places. Nothing in `index.html` names a city, so a new city is a new file and no code change.

St. Petersburg, FL is the only real city so far.

## Where the file goes

- One file per city, named for its id: `data/<cityId>.json`, like `data/examplecity.json` for a city whose `cityId` is `examplecity`.
- `data/stops.json` stays the first city. It is St. Pete, and it owns every `#play/` link that carries no city. Old links never name one.
- The shape is `data/stops.schema.json`. Check the file against it before you open a pull request: `npm test` does this for the files it knows about.

## The config

These sit at the top of the file, before `stops`. Every one is required except `rainLine` and `fixture`.

| Field | What it is |
| --- | --- |
| `city` | The full name, like "St. Petersburg". Shown on the day's first screen and on the creator's desk. A saved day from before cities were a field says this name, so it must not change. |
| `cityId` | A short lowercase id, like `stpete`. Letters, digits and hyphens, starting with a letter. Sent links carry it. |
| `short` | The short name for lines like "A day in St. Pete". |
| `region` | The state or region as people write it in an address, like `FL`. Added after a typed place in Get directions. |
| `regionNames` | Lowercase ways a typed place can already name the region, like `["fl", "florida"]`. If the typed place has one of them, nothing is added. |
| `timeZone` | An IANA time zone name, like `America/New_York`. The page runs the day's clock in it: open now, closing times and after midnight all follow it. A name that isn't real fails the load. |
| `weather` | `{ "lat": ..., "lon": ... }` where the forecast is read from. The point has to be inside National Weather Service coverage, written to 3 decimals. The page asks `api.weather.gov` for exactly that point. |
| `sun` | `{ "lat": ..., "lon": ... }` where sunrise and sunset are worked out. Separate from `weather` because the two don't have to match. Parks that open by the sun use it. |
| `rainLine` | One true line about local rain, shown on the plan B screen after the forecast. Leave it out when there is nothing true to say. |
| `fixture` | `true` for a test-only city. The page never offers it. Leave it out for a real city. |

## Rules that never bend

- `cityId` and every stop `id` are permanent. Sent links carry them, so renaming one breaks a link someone is holding.
- `cityId` and stop ids are unique across every city file, not just inside one. A stop id that another city already has fails the load.
- The place facts are never guessed. Every place needs a `source` URL and a real `hoursChecked` date, the day its hours were last checked against that source. Only St. Pete's 19 original places may have `hoursChecked` set to `null`. They came before the check dates.
- A deck is frozen in the link and only ever plays against its own city's places. A link that names a city the page doesn't have shows the broken-link screen.

## Test-only cities

A city with `"fixture": true` is for `qa-verify.mjs` only. It lives in `qa-fixtures/`, its places are obviously fake (names start with "QA Fixture"), and its source is `https://example.invalid/`. The page never loads it. A test hands it to a fresh page with `addCity(data)`.

## Before you open the pull request

1. The file passes `data/stops.schema.json`.
2. The time zone and the weather point are real.
3. Every place has a source and a real check date.
4. `npm test` passes.
