# RoboArena — Test report

All commands were run on the development machine (Windows 11, Node 24, npm 11, Chromium via
Playwright at 1600×900 unless noted). Every number below was produced by the cited command.

## 1. Engine suite (Vitest, node environment)

Command: `npx vitest run` (2026-10-28) — **27/27 passed**, 5 files.

| File | Coverage |
|---|---|
| `tests/astar.test.ts` (4) | Empty-grid route = Manhattan length; maze route length equals BFS shortest path + path contiguity/walkability; disconnected map → explicit `null`; blocked goal → `null`. |
| `tests/allocation.test.ts` (6) | 4-package/2-robot hand-checkable feasibility; 15 tasks mixed S1+H10 → all assigned, per-trip capacity holds, multi-trip; more tasks than instantaneous capacity completes via repeat trips; zero-task mission; single-robot all-S1/all-H10 studies; fleet-comparison makespans measured (not fabricated ranking). |
| `tests/reservations.test.ts` (5) | Same-direction corridor conflict-free; opposing robots cross via passing bay with no shared cell and no head-on swap; bay-less head-on corridor **fails explicitly** (honest prioritized-planning limitation); idle robot's cell never driven through; converging targets separated in time/space. |
| `tests/simulation.test.ts` (6) | Pickup ≠ delivery (unload-at-dock semantics); byte-identical replay (events + metrics + final cells); chunked stepping equals tick-by-tick; pause/step/reset semantics + robots restored to home cells; **100-seed invariant sweep**; mid-run replan preserves delivered/carried and completes 12/12. |
| `tests/scenarios.test.ts` (6) | Each preset: dimensions ≥ targets, package/robot counts in range, robots on legal cells, every pickup walkable, `validateScenario` error-free, aisle path pickup→dock exists; presets spatially distinct; sample 15-of-N mission plans and completes on **all four** presets. |

The 100-seed sweep (`seed 1..100`, 1–4 robots, 6–23 packages, 75% selection) asserts per-tick:
no two robots share a cell, no head-on edge swap, all positions on walkable cells, cargo ≤
capacity at every tick, one carrier per task, no double delivery, no post-delivery pickup.
Planning failure occurred in **0 of 100** seeds (asserted ≤ 10 allowed).

## 2. Browser verification (Playwright, Chromium)

Browser journeys are automated in `tests/e2e/` (`npm run e2e`). The first pass of this project
verified them by hand in a browser; they have since been turned into repeatable specs.

| Journey | Result |
|---|---|
| Fresh load → Overview renders with 4 preset cards and real counts | ✅ |
| "Open the editor" → warehouse renders (cached static art), validation "Map valid" | ✅ |
| Learn panel opens; Simple/Engineering toggle switches content | ✅ |
| **Real canvas mouse click** on package cell toggles P-01 into the mission (0→1 selected) | ✅ |
| Rack paint on floor → cell becomes rack (revision 2); Undo restores floor | ✅ |
| Rack paint on robot home → **rejected** with "A robot starts there" | ✅ |
| Move package to empty rack cell → storage + pickup cell recomputed, validation clean, replan accepts | ✅ |
| Save custom layout → preset switch → load custom restores 66-package geometry | ✅ |
| Guided demo (one click from Overview) → 15/66 selected, plan 15/15 in ~3 ms, playback starts | ✅ |
| Intervene: pause at tick 72 → block aisle cell → toast "Replanned from t+72s for 2 robot(s), 14 remaining task(s)" → delivered count preserved, carried cargo preserved (7 packages) | ✅ |
| Full mission (15 tasks, 2 robots) → **finished: 15/15 delivered, actual makespan 243 s = planned 243 s**, 6 dock trips | ✅ |
| Deterministic replay in browser: two full runs produce identical event logs (23 events), tick 243, 728 m | ✅ |
| Analyze panel: KPI grid, per-robot meters, event timeline (executed events only), JSON/CSV export buttons wired | ✅ |
| Console/page errors collected across all journeys: **0** | ✅ |
| Tablet 820×1180: layout reflows, canvas usable (read-only-density check) | ✅ |

## 3. Performance (measured in the running app)

| Scenario | Planning latency (5 runs) | Notes |
|---|---|---|
| E-commerce 60×40, 8 robots, 15 selected | **2–6 ms** | est. makespan 79 s, 0 failed robots |
| Cross-dock 64×36, 10 robots, 30 selected | **2–4 ms** | est. makespan 124 s, 0 failed robots |

- Full 30-task cross-dock mission executed: 123 simulation ticks, 30/30 delivered, 2 real
  reservation waits, 1 ms wall-clock for the entire fast-forwarded run.
- Rendering: **89 FPS** (rAF sample over 2 s with live simulation running, 1600×900, WebGL).
  The static layer is one cached texture; per-frame work is a handful of sprites + one Graphics
  redraw, so headroom is large. (Measured on this machine; other hardware will differ.)

## 4. Production build

`npm run build` → `tsc --noEmit && vite build` → success (3.4 s). Bundle > 500 kB warning comes
from the PixiJS+React vendor chunk; acceptable for a local-first desktop tool.

## 5. Known gaps

- The e2e specs hard-code `http://localhost:5173`, while `playwright.config.ts` starts its own server
  on port 5199. Start `npx vite --port 5173` before running `npm run e2e`.
- Screenshots were taken at 1600×900 and 820×1180 (tablet). 1366×768 and 1920×1080 were not
  separately screenshot-verified; CSS uses flex/grid with scrollable panels, and no horizontal
  overflow was observed at 1600 or 820 widths.
- Exported CSV/JSON contents were verified structurally (download triggered, format written);
  byte-level import round-trip of a run export was not separately re-imported (scenario
  import/export round-trip is verified via the save/load journey).
