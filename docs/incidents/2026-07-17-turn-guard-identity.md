# 2026-07-17 — turn contract guards false-failed every agent turn

**Impact:** every plan/implement/review turn across the fleet failed while doing
its job correctly. On gingur/driver#96 the PM re-dispatched the "failed" plan
turn 10 times (~$5.7) before its own reconciler reclassified the failure and
held. Blameless: the change that caused it was correct in isolation.

## What happened

devkit#147 rebuilt the EM turn around explicit intents and **retired the action
panel**. The panel had been posted with `github_token` (`gingur-bot`), so before
#147 every turn left a `gingur-bot`-authored comment on the issue. After #147
the only comment a turn posts is the agent's own — authored by the **Claude
GitHub App (`claude[bot]`)**.

The contract guard in `actions/claude.lib/turn.sh` counted comments like this:

```
select(.user.login == "$BOT" and .created_at >= "$TURN_STARTED")
```

`$BOT` is `gingur-bot`. Post-#147 no `gingur-bot` comment exists, so the count
was always `0` and the guard failed the job with:

```
::error::agent turn ended without posting any comment (contract: at least one per turn)
```

The turn had posted a complete, correct plan. The error asserted the opposite.

## Why it took hours to find

1. **The failure message stated a falsehood.** It claimed no comment existed
   while a valid one sat on the issue, so the obvious hypotheses (credentials,
   OIDC, the agent silently erroring) were all investigated first.
2. **A stale diagnostic note presented a hypothesis as a root cause.** An
   earlier hand-off doc asserted an Infisical `secretTags` gate was to blame.
   It read as established fact and cost real time before being refuted.
3. **The retry loop looked like the problem.** The PM re-dispatching a failing
   turn was a symptom; attention went to the loop rather than the guard.

The break came from reading the failing step's actual log, then asking *who*
authored the comments — `claude[bot]`, not `gingur-bot`.

## Contributing factors

- **A coupled change shipped without its dependent.** Comment identity and the
  verifier that reads it are coupled, but live in different files and shipped in
  different PRs, with no test tying them together.
- **The guard checked a proxy, not the invariant.** "A comment by login X
  exists" stood in for "the agent left its required output". When X changed, the
  proxy broke while the invariant still held.
- **Retry was unbounded.** No circuit breaker capped repeated identical
  failures, and no alert fired on a burst of failed turns.

## Fixes

| Fix | Where |
| --- | --- |
| Guards accept `$BOT` **or** `claude[bot]`; review guard shares `turn_verify_review` | devkit#148 |
| Guards emit evidence (entries in window, authors seen, authors accepted) before failing | devkit#149 |
| Comment-identity contract documented in the standards | devkit#151 (this doc) |
| Fixture test locking the identity contract in CI | devkit#150 |
| "Turns failing in a loop" triage runbook | gingur/driver#107 |
| Circuit breaker: halt + escalate after 3 consecutive failed dispatches | gingur/driver#108 |

## Lessons

- **Read the failing step's real error before forming a hypothesis.** The single
  highest-value diagnostic move, and it was not the first one taken.
- **A check that can be wrong must show its work.** Evidence in the failure path
  converts an hours-long hunt into a glance.
- **Label hypotheses as hypotheses.** Diagnostic notes that state a guess as a
  root cause actively mislead the next reader — including a future agent.
- **Identity is an interface.** Changing who authors a write is a breaking change
  to everything that reads it back.
