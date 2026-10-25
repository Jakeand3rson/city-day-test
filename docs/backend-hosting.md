# Backend and hosting for the first server-side piece

This spike compares three hosting shapes for City Day's first server-side piece. It does not build one. Jake picks.

## What this spike decides

The first server-side piece has to hold a key, run background work, run work on a schedule, store job results, and leave room for an allow-or-deny check later. The comparison is secrets, the per-job ceiling, the queue, the scheduler, the datastore, auth, ops effort, and what happens when the server is down.

## What stays as it is

The site stays a static page on GitHub Pages. The mystery loop stays feel, reveal, go, "We're here." A sent day stays frozen in the `#play/` link. The catalog stays in `data/`. Nothing in this change adds an account or a payment provider.

## Option A. Serverless functions, managed database, managed queue

A function runs when a request or a queue message arrives. The host secret store injects the key into that function. The key stays out of this public repo and out of the static page. Logs record a job id and an outcome. They leave out the key, headers, and any address that could carry the key.

A managed queue holds research and gap-log work. A job that fails is retried, then moved to a dead-letter path a person can see. A scheduler on the same host puts refresh work on that queue. The database stores job state and research output. A sent day stays in the `#play/` link, not only in the database.

Before a job calls out, the function reads a counter the owner set in the host configuration, outside this repo. The job stops at that ceiling. The ceiling is to verify. A job that cannot read the ceiling does not call out.

The same function can read an allow-or-deny flag before it accepts work. Issue #54 stays needs-decision, so this option does not choose sign-in or a payment provider.

Ops is configuration, rotating the key, the dead-letter path, and changes to the stored shape. There is no process to keep awake. GitHub Pages still serves the page when the functions host is down, and a frozen deck plays with no call to it.

## Option B. Small always-on service

One long-running process holds the key in the host secret store, pulls from a managed queue, runs a scheduler loop, and writes the same kind of database. The same pre-call counter stops work at the owner-set ceiling. The ceiling is to verify. Logs stay free of the key. An allow-or-deny read can sit in front of accepted work. Issue #54 stays needs-decision.

This can run the same jobs as option A. Ops adds deploys, restarts, and watching that the process is up. GitHub Pages still plays a frozen `#play/` deck with this process down.

## Option C. Scheduled repo jobs only

The repo's automation runs a job on a timer. The key lives in that automation's secret store, is injected for that run, and is masked in logs, so it never enters the published page. Pending work is a list in the repo, handled one run at a time. The datastore is `data/*.json`, saved back only after a person reviews it. A person's day stays out of git.

That fits a catalog refresh and gap notes. A live request and an entitlement check need a request path, which this option does not have. A failed run leaves the published site as it is, so play already works. This is a batch lane, not the first server-side piece.

## Secrets and key handling

The key never goes in the public repo, in `index.html`, or in a sent link. The host secret store injects it into the function or the process that calls out. Logs record a job id and an outcome. They do not record the key, request headers, or an address that could carry the key. This is the handling issue #25 asks for: the key stays on a server.

## Per-job spend caps

Each job has a ceiling set by the owner in the host configuration, outside this repo. The job reads that ceiling before it calls out, and it stops when it reaches it. If the ceiling cannot be read, the job does not call out. The ceiling is to verify.

## Queue

Option A and option B use a managed queue for research and gap-log work. Failed work is retried, then held on a dead-letter path. Option C has no queue. It walks a list in the repo, one run at a time.

## Scheduler

Option A uses the host's scheduler to put refresh work on the queue. Option B runs that loop inside the process. Option C uses a timer in the repo's automation. None of them edit a day that has already been sent.

## Datastore

Option A and option B store job state and research output in a managed database. A sent day stays in the `#play/` link. This spike does not put names, notes, or days in that database. Option C stores catalog files in the repo, after a person reviews them.

## Auth and entitlements

Issue #54 stays needs-decision until Jake picks a hosting shape here. Option A and option B can read an allow-or-deny flag before accepting work. They do not choose sign-in or a payment provider. Option C cannot answer that check, because it has no request path.

## Ops effort

Option A is configuration, key rotation, the dead-letter path, and changes to the stored shape. Nobody keeps a process awake. Option B adds deploys, restarts, and a process that has to stay up. Option C is a person reviewing what a run wants to save, with no live request to operate. Option A is the lowest ops of the three that still covers a queue, a scheduler, a datastore, and a later allow-or-deny check.

## Graceful fallback

Play does not depend on the server. GitHub Pages serves the page and the catalog. A frozen `#play/` deck plays from the link with no call out. If the server is down, that play still works. A part of the product that needs the server says it is unavailable, in plain language, and the rest of the day still plays. Today the page makes no such call, and this spike does not add one.

## Recommendation

Option A. It confirms the default: serverless functions, a managed database, and a managed queue. The key stays on that server. A queue, a scheduler, and a datastore fit that shape, and the ops load is the lowest of the three that can do the job. Option B can run the same jobs and adds a process to keep up. Option C stays a batch lane for catalog refresh.

## Out of scope

Building the backend. Choosing a payment provider. Deciding entitlements (issue #54).

## To verify outside this repo

Commercial terms: to verify. The per-job ceiling: to verify. Which host to buy it from: to verify. None of those belong in this public repo.
