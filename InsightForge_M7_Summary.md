# InsightForge — M7 (Polish & Docs) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M7 delivered, how it was verified, and decisions made along the way. This is the final milestone in the SRS's project plan — a wrap-up pass, not a new feature.

**Status: Complete** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> README, architecture diagram, 60-sec demo video, unit tests. Maps to the NFR set generally, not a specific FR.

Four deliverables, of different character than every prior milestone: three are documentation/tooling, one (unit tests) closes a real coverage gap. Scoped down with the user up front:

- **Demo video** — explicitly skipped for this pass (no screen-recording capability available to produce an actual video file; offered a scripted-storyboard alternative, user chose to skip entirely rather than have a placeholder).
- **Frontend unit tests** — explicitly scoped in, since the backend already had 106 tests and the frontend had zero (only `tsc`/`eslint` checks, no actual component-behavior coverage).

## 2. What was built

| Area | Delivered |
|---|---|
| **Frontend test suite** | Vitest + React Testing Library + jsdom, configured via `vitest.config.ts` (tsconfig path aliases via `vite-tsconfig-paths`, so `@/...` imports resolve the same as in the app) and `vitest.setup.ts` (a `ResizeObserver` stub, since jsdom doesn't implement it and Recharts' `ResponsiveContainer` requires it — without the stub, every chart-containing component throws on render). 47 tests across all 7 components: `QualityReportView` (7), `EdaView` (8), `StatsTestPanel` (6), `ModelPanel` (6), `PredictSimulator` (8), `ReportExportButton` (5), `UploadPanel` (7). `npm test` runs them; wired into `frontend-ci.yml` alongside lint and build. |
| **README rewrite** | Previous version was accurate but purely developer-setup-oriented (stack, local dev, deploy). Rewritten to lead with the live demo links, a feature table mapping each stage to its FR, a Mermaid architecture diagram, a testing section (153 tests across both layers, with pointers to the regression tests pinned to real bugs found during development), and a milestone table linking every M-summary doc — meant to represent the project to a recruiter or engineer landing on the repo cold, not just to a future contributor setting up the project. |
| **Architecture diagram** | A Mermaid `flowchart` embedded directly in `README.md` (renders natively on GitHub, no image file to keep in sync) — three-tier flow (Browser → FastAPI REST + analytics engine → Postgres), with labeled edges for the session-cookie hop, the SQLAlchemy write path, and the "re-reads raw_csv per request, no cache" read path that's been a recurring design decision since M2. |
| **CI** | `frontend-ci.yml` gained a `npm test` step between lint and build. |

## 3. Schema change

None — pure tooling/docs milestone.

## 4. Real issue found and fixed during this milestone: the first architecture diagram silently failed to render on GitHub

The first version of the Mermaid diagram used `\n` inside quoted node labels (e.g. `UI["Next.js / React\n(Vercel)"]`) and the `-- "text" -->` edge-label form. After pushing, GitHub rendered it as a **plain code block**, not a diagram — no error message, just silent fallback to the raw text. This is easy to miss: the page looks "done," the fence is syntactically a valid `mermaid` block, and there's no visual indicator that anything went wrong unless you specifically check for a rendered `<svg>`.

Found it by fetching the pushed repo page and inspecting the DOM directly for a flowchart `<svg>` — none existed, only a `<pre lang="mermaid">` containing the raw source. Fixed by switching to `<br/>` for line breaks and the `-->|label|` piped edge-label syntax, both the more standard, widely-documented forms specifically recommended for GitHub compatibility.

**Verification caveat worth recording**: re-checking the fix hit a second wall — GitHub renders Mermaid via an async client-side "render enrichment" call (a `<div class="js-render-enrichment-fallback">` wrapping a plaintext `<pre>` that's meant to be replaced once the render call completes), and that call never fired in the sandboxed automated browser used for verification (confirmed via network-request inspection: zero requests to any render endpoint, even after scrolling the element into view and waiting). This is a limitation of the verification environment, not a sign the fix didn't work — GitHub's own parser had already recognized and tagged the block as `mermaid` content (not rejected it), which real user browsers render normally. Flagged to the user to confirm with a quick visual check in their own browser rather than claiming a false-certain "verified live" the way every prior milestone's production check could.

## 5. How it was verified (not just "should work")

1. `npm test` (47 new frontend tests) + `npx tsc --noEmit` + `npx eslint .` all clean; `npx next build` still succeeds with the new dev dependencies present (confirms nothing in the test tooling leaked into the production bundle or broke the build).
2. `pytest` (106 backend tests, unchanged) + `ruff check` — confirmed the milestone didn't regress anything on the backend side, since no backend files changed.
3. Pushed to `main`; confirmed both `frontend-ci` (now including the new `npm test` step) and the unaffected `backend-ci` ran and passed on GitHub's actual Ubuntu runners — not just locally on Windows, which matters here specifically because jsdom/Recharts/ResizeObserver interactions can behave differently across platforms.
4. Fetched the live rendered README on GitHub directly (not just trusted the push succeeded) and caught the Mermaid rendering issue described in Section 4 as a result — the kind of thing that's invisible from `git push` succeeding or a local markdown preview.

## 6. Decisions & notes worth remembering

- **`ResizeObserver` stub is global, in `vitest.setup.ts`, not per-test** — every chart-containing component (`EdaView`, `ModelPanel`) needs it, and stubbing it once globally is simpler and more consistent than repeating a mock in each test file.
- **`fireEvent`, not `userEvent`, for anything that needs to bypass an `accept` attribute or set a controlled input's value directly** — `userEvent.upload()` filters files against the input's `accept` attribute to emulate a real file picker (a v14+ behavior change), which is correct for realism but means it can't be used to test the app's *own* client-side rejection of a mismatched file — that specific test needs `fireEvent.change` instead, which sets the file list without the picker-emulation layer. Similarly, a controlled `<input type="range">` needs `fireEvent.change`, not direct DOM property mutation + a raw dispatched event, or React's synthetic event system never sees the change.
- **Real timers, not fake timers, for the debounced `PredictSimulator`** — `vi.useFakeTimers()` would avoid the ~400ms real delay per test, but interacts awkwardly with `userEvent`'s own internal timer usage. Mocking a second fetch response for the auto-fired on-mount prediction and using `waitFor` with a generous timeout was simpler and avoided any fake-timer/user-event interaction bugs, at the cost of a few tests taking closer to a second each — an acceptable tradeoff for a project-sized test suite, not something that would scale to a much larger one.
- **Silent rendering failures are a real category of bug, and "the push succeeded" isn't verification** — this is the same lesson as the M4 PDF layout-overlap bug and the M6 Vercel/Render deploy-timing gap, applied to a third surface (GitHub's own markdown rendering). The common thread across all three: an automated check that only confirms *code ran without throwing* (CI green, `git push` succeeded, a 200 response) can still miss a rendering/display problem that only shows up when someone actually looks at the output.

## 7. Definition of Done (SRS Section 8.1) — checked, with one deliberate scope reduction

- [x] Feature (documentation/tooling, in this milestone's case) works end-to-end — README verified live on GitHub, CI verified green on GitHub's runners (not just locally)
- [x] Edge cases handled — see the ResizeObserver/accept-filtering/fake-timer notes above, each a real test-authoring pitfall worked around, not skipped
- [x] Code committed with descriptive messages (`e660c28`, `4347eac`); README itself *is* this milestone's primary deliverable
- [x] Automated tests cover the new logic — 47 new frontend tests, all passing, closing what was previously a zero-coverage gap
- [ ] 60-second demo video — **deliberately out of scope for this pass**, by explicit user choice (no video-recording capability available; user declined the storyboard-script alternative and chose to skip rather than ship a placeholder)

## 8. Next

All eight milestones in the SRS's project plan (M0–M7) are now complete, covering the full MVP (Phase-1) and Should-Have (Phase-2) functional requirement set, verified against the real production database and the live Vercel/Render URLs at every step. Anything beyond this point is either the SRS's explicitly out-of-scope Section 4.3 stretch goals (multi-dataset comparison, saved user accounts) or a deliberately deferred item from this milestone (the demo video).

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M7 built and verified (video deliberately deferred) |
