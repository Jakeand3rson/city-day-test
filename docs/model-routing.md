# City Day: model routing policy (Cursor agents)

Applies to Cursor cloud agents and subagents in this repo. On-demand usage is **off**; this policy keeps work moving without ever needing it.

## Background

- Cursor has two included usage pools: **Cursor Models** (Grok 4.7, Grok 4.6, Composer 2.5) and **Other Models** (third-party: Claude, GPT, Gemini). Both reset each billing cycle.
- When Other Models runs out, work moves to Cursor Models. If that runs out too, work would need on-demand, which is off, so work pauses.
- Auto can route to third-party models, so Auto is not a way to stay in the included pool.
- A subagent pinned to a third-party model draws from Other Models even if the parent runs on Grok or Composer.
- `.cursor/agents/*.md` frontmatter `model:` takes `inherit` or a model ID with params, e.g. `composer-2.5[fast=false]`. `.cursor/` beats `.claude/`. Cursor ignores the pin if an admin blocked the model or the plan lacks it.
- Grok 4.7 effort param is `reasoning_effort` (xhigh / high / medium / low). Fast mode is heavier on usage; always use `fast=false`. Keep context under 256k.
- Local subagents pinned to Grok 4.7 were reported starting on Auto (Cloud Agents unaffected). Workaround: `cursor-grok-4.6-high`.

Grok is **not** unlimited. Running out of Cursor Models with on-demand off also stops work.

## Tiers

| Tier | Models (pool) | Use for |
|---|---|---|
| **P (premium)**, rarely | `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-5.6-sol` / `gpt-5.6-terra` (Other Models) | Only hard implementation (size:L, play loop, share-link format, catalog schema) and architecture/spike plans, and only while Other Models has budget. |
| **S (strong included)** | `grok-4.7[reasoning_effort=high,fast=false]`; xhigh only for architecture (Cursor Models) | Default implementer and Tech Lead when P is unavailable; all normal implementation. |
| **C (cheap included)** | `composer-2.5[fast=false]` (Cursor Models) | Review, advising, triage, docs, PR descriptions, summaries, PM Q&A, ticket specs, QA scripting, CI/deploy checks, security/UX scans. |

Rules:
1. Default to C. Move up a tier only with a stated reason in the Team log.
2. Always `fast=false`.
3. Keep Grok 4.7 context under 256k. Don't use the 500k variant.
4. Never use Auto for cost control. Pin explicit IDs.
5. Never pin a third-party model in a subagent while Other Models is exhausted.

## Fallback chain

Work never bills on-demand. On-demand stays **off** as the hard backstop.

```
Claude (Sonnet 5.5 / Opus 5.5)            [Other Models]
  -> GPT-5.6 Terra                        [Other Models, same pool]
  -> Grok 4.7 high (xhigh for arch)       [Cursor Models]
  -> Grok 4.6 high (cursor-grok-4.6-high) if a Grok 4.7 pin starts on Auto
  -> Composer 2.5 (fast=false)            [Cursor Models]
  -> pause and ask PM                     (Cursor Models exhausted; wait for reset)
```

Claude and GPT share the Other Models pool, so when one is out, both are. The real boundary is Other Models -> Cursor Models.

Modes (EM checks the usage dashboard at session start):
- **Mode A** (Other Models budget left): premium pins for P-tier roles only.
- **Mode B** (Other Models exhausted): every role on Grok/Composer (the committed pins).
- **Mode C** (Cursor Models >90% used): everything on Composer 2.5; size:S/M only; post `Question for PM:` before size:L.
- At the billing-cycle reset, return to Mode A.

## Per-role pins

| Role (file) | Function | Mode A | Mode B (committed pin) |
|---|---|---|---|
| engineering-manager | planner/orchestrator, PM Q&A, ticket specs | composer-2.5[fast=false] | composer-2.5[fast=false] |
| tech-lead | architect/planner | claude-opus-5-5[effort=high] | grok-4.7[reasoning_effort=xhigh,fast=false] |
| developer | implementer | claude-sonnet-5-5 | grok-4.7[reasoning_effort=high,fast=false] |
| code-reviewer | verifier (different family from developer) | composer-2.5[fast=false] | composer-2.5[fast=false] |
| qa-engineer | verifier | composer-2.5[fast=false] | composer-2.5[fast=false] |
| tech-writer | docs | composer-2.5[fast=false] | composer-2.5[fast=false] |
| security-privacy-reviewer | verifier | composer-2.5[fast=false] | composer-2.5[fast=false] |
| ux-accessibility-reviewer | verifier | composer-2.5[fast=false] | composer-2.5[fast=false] |
| devops-release | CI/deploy check | composer-2.5[fast=false] | composer-2.5[fast=false] |
| data-catalog-researcher | research/summaries | composer-2.5[fast=false] | composer-2.5[fast=false] |

In Mode A, premium is used only for Tech Lead plans and Developer on hard tickets. For size:S/M in Mode A, the EM launches the developer with an explicit `grok-4.7[...]` model.

Mode A alternates live in each agent file's body, not as frontmatter comments (Cursor's subagent docs don't document `#` comments in frontmatter).

## Logging

In the PR Team log, the EM records for every role invocation: role, model ID actually run (from the subagent task card, not the pin), pool, mode (A/B/C), and why any role ran above tier C. If it differs from the pin, log `pinned X -> ran Y`.

## Open questions

- Exact behavior when a pinned third-party subagent runs with Other Models exhausted and on-demand off (error vs. silent fallback).
- Whether the Grok 4.7 local-subagent fix has fully shipped (Cloud Agents reported unaffected).
- `.claude/agents` pins apply to Claude Code, not Cursor, and are left unchanged.
