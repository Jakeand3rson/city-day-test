# City Day — agent pointer

1. Read `CLAUDE.md` (product rules and flow).
2. Read `CONTRIBUTING.md` and `docs/SDLC.md` (claiming, labels, questions).
3. Name your team in the PR and in the claim (e.g. `cursor-<id>` or a Claude session ID).
4. Follow the charter at [docs/reviews/2026-10-direction.md](docs/reviews/2026-10-direction.md) in this repo. It beats everything else. Do not open any other repo.
5. Cursor cannot comment on issues. The Engineering Manager opens a draft PR with `Closes #N` and keeps one Team log comment on that PR. See [Claiming a ticket](docs/SDLC.md#claiming-a-ticket).
6. One issue per PR. Never push to `main`. Never merge.
7. Model spend: follow the routing and fallback rules in `.cursor/rules/city-day-cursor-team.mdc`.
   On-demand billing is off; when premium usage runs out, fall back to Grok/Composer, never stop.
   Record the model each role actually ran in the PR Team log.
8. Quality gates: a premium plan gate before implementation and a premium merge gate (different
   model family from the developer) before the PR is marked ready; failed tests, diffs over ~300
   lines, or auth/data/payments changes escalate early. Pins are not overridden at launch except for
   those escalations. See `docs/model-routing.md#quality-gates`.
