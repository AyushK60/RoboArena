# RoboArena 1.3 — Design notes ("Plan Sheet")

Presentation-only redesign. Engine, state, scenarios and canvas renderer
(`src/engine`, `src/state`, `src/scenarios`, `src/render`) are untouched. No ids, handlers, store
calls or e2e-referenced class names were renamed.

## Direction
Cool Technical with an editorial voice: a drawing/plan-sheet identity for a tool whose subject is
floor plans and routes.

- **60 / 35 / 5.** 60 field (paper cream on the landing, deep navy ink in the studio), 35 the
  opposite pole (navy ink on paper; cream ink and slate panels on navy), 5 signal vermilion — the
  only highlight: primary action, one italic headline word, the Hauler route, the last timeline node.
- **Type.** Newsreader (display/serif, incl. italic), Geist (UI), Geist Mono (data, labels). Google
  Fonts with `display=swap`; system fallbacks are set in tokens.
- **Tokens.** `src/styles/tokens.css` holds every colour/type/space/radius/motion value;
  `global.css` only consumes them. `.lp` re-themes to light; `.t-dark` re-applies the dark set to
  blocks inside the landing (plan-sheet frame, "Honest limits", footer).
- **Functional colours** (route cyan, amber waits, green/red status, robot swatches) are unchanged
  because they mirror canvas art; they are the one documented exception to "tokens only"
  (`robotCss` and legend swatches in `App.tsx`).

## Landing
Full-width two-line serif headline → action row (lede left, actions right) → wide navy plan sheet
(redrawn schematic, Scout route cream, Hauler route vermilion, legend strip with real facts) →
"How it works" as a station timeline on the paper → four warehouses as a ruled list (hover flips
to navy) → numbered observations beside a navy "Honest limits" panel → navy footer. Hero lines
rise on load; sections fade in once on scroll (IntersectionObserver armed after mount, disabled
under `prefers-reduced-motion`).

## Studio
Underline-tick tabs, vermilion for active/selected/primary, mono caps section labels with
hairline rules, serif panel titles and stat numerals, flat hairline panels, transport strip with a
vermilion play button, restyled guided card/modal/toasts/stale banner, designed empty states,
two-row header at ≤820px so tabs, preset select and panel toggles are all reachable on phones.

## Bugs fixed on the way
- `--ui-accent-bg/-border` were undefined, so active tabs/tools/segments had no fill.
- Robot state colours never applied (`st-toDock`/`st-pickingUp` vs lowercase selectors).
- At 390px the studio header overflowed (preset select, Save/Import and Tools/Mission toggles were off-screen).
- Dead CSS (`.hero`, `.preset-card`, `.landing`, `.how-strip`, …) and a corrupted token removed.

## Verification
`tsc` clean · 37 vitest · 13 e2e (presets + studio) · 0 horizontal overflow at 1440/820/390 ·
console clean. Contrast (WCAG): all body/UI text pairs ≥ 4.5:1; vermilion text on paper
(3.9:1) is used only at display size. Screenshots: `docs/screenshots/`.

## Notes
- E2E specs hard-code `localhost:5173` while `playwright.config.ts` serves on 5199; run
  `npx vite --port 5173` first.
- Fonts load from Google Fonts; offline, the fallback stacks are used.

## Canvas retheme + transition (follow-up)
The warehouse canvas now belongs to the same system. Changed files: `src/render/palette.ts`,
`static-art.ts`, `dynamic-art.ts`, `warehouse-renderer.ts` (colours, fonts, one font-ready rebuild);
geometry, engine and simulation logic are untouched.

- **Floor and racks:** navy drafting plate (per-preset navy tints), steel-blue rack frames, kraft
  cartons kept as the warm contrast. Floor markings, dock bay numbers, trucks and lane arrows use
  paper cream instead of safety yellow. Restricted zones use the vermilion highlight.
- **Zone tints:** receiving/shipping blue, packing kraft amber, charging mint, staging cream,
  sorting teal, storage slate — all tuned to sit on the navy plate.
- **Type on canvas:** Geist Mono for zone labels, grid letters, robot IDs, package chips, minimap
  and delivery counter; Geist for tooltips. Text is baked into a cached texture, so the renderer
  rebuilds it once `document.fonts` has loaded the faces.
- **Kept on purpose:** route cyan, S1 cyan / H10 amber robot classes, amber waits/packages, mint success.
  Panel robot dots now mirror the canvas colours (they previously used an unrelated rainbow).
- **Transition:** choosing a warehouse (or Studio / guided mission) slides the landing sheet up with a
  vermilion edge, then the studio enters in a short stagger (header, tool panel, mission panel,
  transport bar) while a single vermilion scan line sweeps across the canvas. The landing stays
  mounted for 0.8 s; it is `pointer-events: none` meanwhile. Skipped under `prefers-reduced-motion`.

## Light / dark studio with a toggle (follow-up)
The navy plate was replaced; the studio now has two themes, switched with the sun/moon button
in the header (persisted in `localStorage`, dark by default, applied before first paint).

- **Light — paper floor plan.** Cream floor, navy rack outlines, kraft cartons, vermilion restricted
  zones. Robot identity matches the landing schematic: Scout (S1) navy family, Hauler (H10) vermilion
  family; routes, badges and panel dots follow.
- **Dark — graphite.** Neutral warm graphite concrete floor with steel racks and cream markings
  (no blue tint); chrome is graphite with cream ink. The landing keeps its navy blocks (`.t-dark`).
- **How it works.** `src/render/palette.ts` holds both canvas palettes; the live `MAP` object is read
  at draw time, and `WarehouseRenderer.setTheme()` rebuilds the baked static texture, robots,
  routes, package markers and minimap. `src/ui/theme.ts` owns the state; `tokens.css` has
  `:root`/`[data-theme='dark']` and `[data-theme='light']` token sets.
- Legend swatches and robot dots read from the canvas palette so UI and canvas never disagree.
