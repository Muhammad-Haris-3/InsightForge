# InsightForge — UI Design System

**Status:** Shipped and live at https://insight-forge-beta.vercel.app
**Scope:** Visual layer only. No API contracts, schema, or analytics logic changed.
**Introduced by:** `ce2da77` (structural pass) and `62f3bd4` (design system).

This is a living reference for the app's visual layer — read it before adding a
new panel or chart so the next component looks like it belongs.

---

## 1. Design language

Dark-only, glassmorphic, with an emerald→teal→cyan accent ramp on a deep navy
ground. Three ideas carry it:

- **Depth through translucency, not borders.** Panels are semi-transparent
  surfaces with `backdrop-filter` blur over an animated mesh gradient, so the
  background shows through and the page reads as layered rather than boxed.
- **Accent used sparingly as signal.** Emerald marks interaction and success
  (primary buttons, focus rings, slider thumbs, the prediction card). Body
  content stays in neutral slate so the accent never competes with data.
- **Motion as entrance, not decoration.** Content fades up on mount with a
  stagger; ambient animation is limited to the background mesh and one float.

Light mode was deliberately dropped — `<html>` is hard-pinned to `dark` in
`layout.tsx`. This is a portfolio product with one intended look; supporting two
themes would have doubled the palette validation surface for no user benefit.

---

## 2. Tokens

Defined on `:root` in [globals.css](frontend/src/app/globals.css).

| Token | Value | Used for |
|---|---|---|
| `--background` | `#0b0f1a` | Page ground |
| `--foreground` | `#e2e8f0` | Primary text |
| `--surface-0` | `rgba(15, 23, 42, 0.6)` | Card fill |
| `--surface-1` | `rgba(30, 41, 59, 0.5)` | Secondary button fill |
| `--surface-2` | `rgba(51, 65, 85, 0.4)` | Slider track |
| `--border-subtle` | `rgba(148, 163, 184, 0.08)` | Default card border |
| `--border-glow` | `rgba(52, 211, 153, 0.15)` | Card border on hover |
| `--accent-1` / `-2` / `-3` | `#34d399` / `#2dd4bf` / `#22d3ee` | Gradient ramp (emerald→teal→cyan) |

Surfaces are intentionally **rgba, not opaque** — `backdrop-filter` has nothing
to blur behind an opaque fill, and the glass effect collapses.

---

## 3. Primitives

Hand-rolled CSS classes rather than Tailwind `@apply`, so each primitive is one
named thing to change. Usage counts are as of this writing.

| Class | ×  | Purpose |
|---|---|---|
| `.glass-card` | 5 | Top-level panel — blur, inset highlight, emerald border-glow on hover |
| `.glass-inner` | 5 | Nested surface inside a card (chart wells, result rows) |
| `.error-card` | 5 | Red-tinted error banner |
| `.select-styled` | 4 | `<select>` with custom SVG caret and emerald focus ring |
| `.stat-card` | 2 | Metric tile with a gradient top-edge accent (`::before`) |
| `.btn-primary` | 2 | Emerald→teal gradient CTA, lifts 1px on hover |
| `.btn-secondary` | 1 | Neutral surface button |
| `.upload-zone` | 1 | Dashed dropzone with `.drag-over` state |
| `.premium-table` | 1 | Uppercase tracked headers, hover row tint |
| `.prediction-card` | 1 | Emerald-tinted gradient for the What-If result |
| `.gradient-text` | 1 | Accent-ramp text clip (wordmark) |
| `.badge` | — | Pill with blur; color applied per-instance |
| `.section-divider` | — | Fading hairline rule |

Two details worth preserving when editing:

- `.select-styled option` is explicitly set to `#1e293b` — native dropdown
  popups don't inherit the page theme and render white-on-white without it.
- `-webkit-backdrop-filter` accompanies every `backdrop-filter` for Safari.

---

## 4. Motion

| Keyframe | Utility | Where |
|---|---|---|
| `fadeInUp` | `.animate-fadeInUp` (×9) | Panel entrance |
| `fadeIn` | `.animate-fadeIn` | Sub-content entrance |
| `float` | `.animate-float` (×1) | Upload icon idle |
| `meshMove` | — (on `.mesh-bg::before`) | 20s ambient background drift |
| `shimmer` | `.animate-shimmer` | Loading skeletons |
| `glowPulse` / `borderGlow` | `.animate-glowPulse` / `.animate-borderGlow` | Attention states |
| `spin` | `.animate-spin-custom` | PDF export spinner |

Entrance stagger uses `.delay-100` … `.delay-500` (0.1s steps). `fadeInUp` and
`fadeIn` use `both` fill so staggered elements stay hidden until their turn
rather than flashing at full opacity first.

---

## 5. Chart palette

Recharts colors were **re-tuned for the dark ground** — the earlier light-mode
values (`#2a78d6`, `#1baf7a`, `#eb6834`) are mid-lightness and go muddy against
`#0b0f1a`. Each moved up to its 400-level equivalent:

| Chart | Constant | Value |
|---|---|---|
| Numeric histograms | `HISTOGRAM_COLOR` | `#60a5fa` (blue-400) |
| Category frequency | `FREQUENCY_COLOR` | `#34d399` (emerald-400) |
| Feature importance | `IMPORTANCE_COLOR` | `#fb923c` (orange-400) |
| Correlation, positive | `DIVERGING_POSITIVE` | `#60a5fa` |
| Correlation, negative | `DIVERGING_NEGATIVE` | `#f87171` (red-400) |

The correlation heatmap is a **true diverging scale** — two hues meeting at a
neutral, never a rainbow — and flips its label to white past `|r| > 0.45` so
text stays readable as the cell saturates. A swatch legend sits under the grid
because the encoding is otherwise color-only.

Recharts internals are themed globally in `globals.css` (grid stroke, tooltip
surface, `.recharts-text` fill) rather than per-chart, so a new chart inherits
the theme without prop plumbing.

---

## 6. Verification

All checks run against the design system as shipped:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |
| `npx vitest run` | 47/47 passing |
| `npm run build` | compiles, 4 static pages |
| `pytest` (backend, unaffected) | 106/106 passing |
| Live end-to-end on Vercel + Render | upload → EDA → test → model → simulate → PDF all functional |

Two component tests were updated with the redesign — they asserted on classes
the redesign renamed (`text-amber-600`→`text-amber-400`, `font-semibold`→
`font-bold`). Both still assert the same user-visible behavior.

---

## 7. Accessibility — audited, two open items

Contrast measured on the live page against the real composited background
(`rgb(11,15,26)`), not estimated:

| Element | Color | Ratio | Verdict |
|---|---|---|---|
| Primary text | `#e2e8f0` | 15.52:1 | ✅ |
| Secondary text | `#94a3b8` | 7.28:1 | ✅ |
| Badge text (blue/teal) | — | 10.31–10.55:1 | ✅ |
| **Muted text + chart axis labels** | `#64748b` | **4.02:1** | ⚠️ under AA (4.5:1) |

**Open item 1 — muted text is marginally under AA.** `#64748b` (slate-500) at
10–12px lands at 4.02:1. Moving those instances to `#94a3b8` (slate-400) reaches
7.28:1 — a value already in the palette, so it's a token swap, not a redesign.
Affects `.recharts-text` in `globals.css` and the axis `tick.fill` props in
`EdaView.tsx` / `ModelPanel.tsx`.

**Open item 2 — no `prefers-reduced-motion` support.** The background mesh
animates indefinitely and every panel animates on entrance, with no opt-out for
users who've asked their OS to reduce motion. One block fixes it globally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Neither changes the default appearance for anyone not already opted in.

---

## 8. Extending it

1. Wrap new top-level panels in `.glass-card`, nested wells in `.glass-inner`.
2. Add `.animate-fadeInUp` plus the next `.delay-*` step so entrance stays staggered.
3. Reach for an existing primitive before writing new CSS — if you need a new
   one, name it here.
4. For a new chart series, pick a 400-level hue that isn't already assigned
   above, and re-check contrast against `#0b0f1a` before committing.
5. Keep text in slate tokens. The accent means "interactive or successful" — if
   it starts appearing on static text, that signal is gone.

---

## Document Control

| Field | Value |
|---|---|
| Covers | `ce2da77`, `62f3bd4` |
| Related | [M7 Summary](InsightForge_M7_Summary.md) (preceding milestone), [README](README.md) |
