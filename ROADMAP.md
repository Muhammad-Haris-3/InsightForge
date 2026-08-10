# InsightForge — Roadmap

All SRS Phase-1 and Phase-2 requirements are complete and live. This is the
post-MVP backlog, ordered by **impact per hour of work** rather than by feature
size, so it can be worked in short daily sessions without losing the thread.

Each item states why it matters, because "nice to have" is not a reason to build
something.

---

## Tier 0 — Credibility fixes

Small, unglamorous, and the things a senior reviewer probes first. Every one of
these is a question someone could ask that currently has no good answer.

### 0.1 Rate-limit the upload endpoint · ~1h
`POST /api/datasets/upload` is public, unauthenticated, and unthrottled. Anyone
can loop it. Add `slowapi` with a per-IP limit (e.g. 10 uploads/min).
**Why it matters:** "What stops someone hammering this?" is the first question
about any public write endpoint. Currently: nothing.

### 0.2 Reject oversized uploads before buffering · ~1h
`upload_dataset` calls `await file.read()` — pulling the *entire* body into
memory — and only then checks the 10 MB cap in `validate_and_parse_csv`. A 2 GB
POST is fully buffered before rejection, on a 512 MB Render instance.
**Fix:** check `file.size` (Starlette populates it) or read in bounded chunks and
abort past the cap.
**Why it matters:** it's a real OOM denial-of-service in code that already
*looks* like it validates size. Catching it yourself is a strong signal.

### 0.3 Data-retention job · ~2h
`schema.sql` documents a session-pruning job against
`idx_sessions_last_active_at` that was never built. Neon currently holds orphaned
datasets from development, each with its `raw_csv` bytea, and nothing ever
removes them. Add a scheduled job deleting sessions idle > 30 days (the
`ON DELETE CASCADE` already handles children).
**Why it matters:** closes a documented-but-unimplemented gap, and shows you
think about storage cost and data lifecycle, not just the happy path.

### 0.4 Accessibility: contrast + reduced motion · ~1h
Two measured gaps, both detailed in
[UI Summary §7](InsightForge_UI_Summary.md): muted text at `#64748b` is 4.02:1
(AA needs 4.5:1), and there's no `prefers-reduced-motion` handling despite an
indefinitely animating background.
**Why it matters:** a11y is a cheap, visible marker of professional maturity, and
some employers screen for it directly.

### 0.5 Structured logging + request IDs · ~2h
There is no way to correlate a user-reported failure with a line in Render's
logs. Emit JSON logs with a per-request UUID, echo it in the error envelope.
**Why it matters:** the difference between "it broke" and "here's the trace" is
the difference between a demo and a service.

---

## Tier 1 — Analytical depth

**This is the highest-value tier for a Data Analyst role.** The engineering is
already solid; what distinguishes a data person is knowing what a number *means*
and where it misleads. Every item below is a question an interviewer can ask
about the current output.

### 1.1 Effect sizes alongside p-values · ~3h
Every conclusion says "statistically significant" or not, and stops. With
n=50,000 a trivial difference is significant; with n=12 a large one isn't.
Report **Cohen's d** (t-test), **eta²** (ANOVA), **Cramér's V** (chi-square),
with a magnitude word (negligible / small / medium / large).
**Why it matters:** this is *the* standard critique of naive stats tooling.
Answering it unprompted, in the product, is the single most convincing thing on
this roadmap.

### 1.2 Welch's ANOVA / non-parametric fallbacks · ~3h
`stats_tests.py` correctly uses Welch's t-test (`equal_var=False`) — but ANOVA
uses `f_oneway`, which *does* assume equal variances. The rigor is inconsistent.
Add Levene's test for variance and Shapiro-Wilk for normality; fall back to
Welch's ANOVA (`alexandergovern`) or Kruskal-Wallis, and say in the conclusion
which was used and why.
**Why it matters:** shows you know tests have assumptions — and you already
half-demonstrated it, so finishing the thought is cheap.

### 1.3 Multiple-comparison correction · ~2h
Run 20 tests at α=0.05 and roughly one is "significant" by chance. All tests for
a dataset are already persisted in `test_results`, so the app can see the count.
Apply Benjamini-Hochberg across a dataset's tests and surface an adjusted
p-value plus a warning once several tests have run.
**Why it matters:** p-hacking is the best-known failure mode in applied stats.
A tool that guards against it is doing real analytical work.

### 1.4 Permutation importance + model-quality gating · ~3h
Two problems: random-forest impurity importance is **biased toward
high-cardinality and continuous features**, and the "strongest predictors"
sentence renders identically whether R² is 0.95 or −0.3.
Switch to `permutation_importance`, and suppress or caveat the narrative when the
model doesn't beat a baseline.
**Why it matters:** confidently explaining a model that doesn't work is worse
than not explaining it. Knowing that is seniority.

### 1.5 Confidence intervals on estimates · ~2h
Report a 95% CI for the difference in means / regression metrics. A CI conveys
precision and direction in one object; a p-value conveys neither.

---

## Tier 2 — Product features

### 2.1 Audience-adaptive explanations ⭐ · ~4h
**The strongest feature idea on this list.** A single toggle over the same
results: **Plain English** / **Technical**.

- *Plain English:* "Cities differ in average age, and the gap is big enough that
  it's unlikely to be chance."
- *Technical:* "Welch's ANOVA, F(2,9)=13.84, p=0.0018, η²=0.75 (large). Levene's
  p=0.42, so equal-variance held."

Build it **deterministically first** — a second template per test type off the
same numbers, plus a persisted toggle. No LLM required, no latency, no cost, and
it always tells the truth. An optional LLM narrative layer can come later, but
templates should ship first.

**Why it matters:** the job of a data analyst is translating analysis for people
who don't do analysis. This feature *is* that skill, demonstrated in software.
It also pairs perfectly with Tier 1 — effect sizes and assumption checks give
the Technical mode something real to say.

### 2.2 Shareable read-only report links · ~4h
A tokenized public URL for a dataset's report. Turns the project from "clone and
run it" into "here's a link" — which is how it actually gets looked at by a
recruiter with 90 seconds.

### 2.3 Model leaderboard · ~4h
Train 2–3 algorithms (linear/logistic, random forest, gradient boosting), show a
ranked comparison instead of one baseline. Cheap given `_fit()` is already
factored, and it demonstrates model selection rather than model running.

### 2.4 Cleaned-data export · ~2h
Download the parsed dataset with dtypes fixed and duplicates flagged. Small, and
the single most-requested thing from anyone who actually uses a profiler.

### 2.5 Time-series detection · ~6h
When a datetime column exists, offer trend and seasonality decomposition. Bigger
lift; only worth it if the analytics angle needs more range.

---

## Tier 3 — Engineering signals

| Item | Effort | Why |
|---|---|---|
| Playwright E2E covering the full flow | ~4h | Unit tests exist; nothing tests the assembled app |
| `docker-compose` for one-command local dev | ~2h | Removes all setup friction for a reviewer |
| Publish OpenAPI/Swagger docs | ~1h | FastAPI generates them; just expose and link |
| Sentry error tracking | ~1h | Pairs with 0.5; real services have error tracking |
| Lighthouse + a11y score in README | ~1h | Turns 0.4 into a visible, verifiable claim |
| Load-test results documented | ~3h | Pairs with 0.1 — proves the limit works |

---

## Suggested order

Working ~1h/day, the sequence that maximises how the project *reads* soonest:

1. **0.2 → 0.1 → 0.4** — close the findings that undercut the "production-grade" claim.
2. **1.1 → 1.4** — effect sizes and honest model reporting; biggest analytical credibility jump.
3. **2.1** — audience-adaptive explanations, now that there's substance for Technical mode.
4. **0.3 → 0.5 → Tier 3** — operational maturity.
5. **1.2, 1.3, 2.2, 2.3** — as time allows.

Stop when the marginal item stops teaching you something. A finished project with
a clear boundary beats a perpetually half-upgraded one — the next project on the
portfolio is worth more than Tier 3 item six.
