# RoboArena — Engineering decisions (living document)

Created: 2026-10-28. Design notes and decisions made while building RoboArena.

## Original visual target
Dark navy ops chrome, hero warehouse ≥65% of the work area, dense parallel rack aisles with cartons
and yellow rack feet, tinted zones (Receiving blue, Packing amber, Shipping blue, Charging green,
Restricted red hatch), docked trucks, floor direction arrows, cyan/amber dashed robot routes with
direction arrows, robot ID badges below chassis, left edit toolbar, right Mission Planner, bottom
timeline with clock/playback/KPIs (Jobs completed, Fleet makespan, Distance, Conflicts avoided),
A–L column letters and 1–9 row numbers, scale bar and north arrow. All of this is built as real,
editable PixiJS-rendered objects — no bitmap reference is embedded anywhere.

## Stack (locked for V1)
- TypeScript 5 + React 18 + Vite 5 + PixiJS 8 (WebGL). Vitest for engine tests.
- Node v24.22.0 / npm 11 detected on this machine. No other runtime deps.
- Playwright (Chromium) is used for end-to-end browser tests; see `docs/TEST_REPORT.md`.

## Engine contracts (frozen — CORRECTED 2026-10-28 v1.1 to match code; earlier text said 0.5 s/tick)
- **Determinism**: pure TS core, integer ticks. TICK = 1 simulated second (`TICK_SECONDS = 1`).
  Robots move 1 cell per tick (constant speed, no acceleration). Pickup dwell 3 ticks, dock unload
  dwell 6 ticks. Cell = 2 m × 2 m (reported in UI). Same inputs+seed ⇒ identical tick history.
- **Map**: `Uint8Array` cell grid; `Floor=0, Rack=1, Obstacle=2, Dock=3, Wall=4`. Racks/obstacles/walls
  block movement; Dock cells are walkable service cells. Map `revision` increments on every accepted
  edit; distance caches keyed by revision.
- **Packages**: stable IDs (`P-01…`), storage cell (may sit inside a rack block visually) + adjacent
  walkable pickup service cell + assigned dock. States: unassigned → assigned → carried → delivered;
  unreachable is a planning verdict. One carrier at a time; delivered only after dock unload.
- **Robots**: `S1` capacity 1, `H10` capacity 10, unlimited lifetime trips. Capacity enforced per trip.
  Fleet 1–12, user-mixed. Speeds equal in V1.
- **Mission objective**: minimize predicted makespan (last robot unload time), estimated from graph
  distances + dwells; NOT total distance, NOT per-robot equal split.
- **Allocation (V1, one heuristic, labeled heuristic)**: capacity-aware greedy cheapest-insertion with
  makespan bidding. For each unassigned task, evaluate inserting into every robot at every feasible
  position (current trips with spare capacity, or a new trip); pick the (robot, position) minimizing
  the resulting estimated global makespan; deterministic tie-break (delta, robotIdx, position, taskId).
  Estimator uses precomputed BFS distance maps among {dock, pickups, robot positions} for the current
  map revision, plus dwell terms. Optional post-pass: intra-trip 2-opt for trips ≤ 12 stops.
- **Collision avoidance**: prioritized space-time A* with a reservation table over
  (cell, tick) vertices and (directed edge, tick); wait actions allowed; dwell cells reserved;
  static map blocks respected; robot start cells reserved from t=0. Deterministic priority order
  (longest estimated route first, tie by id); on planner failure, bounded priority-shuffle retries,
  then explicit `planning_failed` for the affected robot — never a phantom route.
- **Replanning**: edits only while paused/design mode. Accept → validate → map revision++ →
  delivered/carried state preserved → re-plan remaining work from current robot cells/ticks.
  Invalid edits rejected with a reason; nothing teleports mid-run; reset/replay is a separate action.
- **Honesty limits**: heuristic ≠ global optimum. Prioritized MAPF can fail where a solution exists —
  reported as unsolved, not faked. "Conflicts avoided" counts real detected-and-reserved conflicts.
- **Mission end (v1.1)**: the visible mission completes at the LAST PARK (robots visibly return to
  their charging bays); fleet makespan is measured at the LAST DELIVERY and reported separately
  (`lastParkedTick`).
- **Two strategies (v1.1)**: `insertion` (capacity-aware greedy cheapest-insertion, makespan
  bidding) and `nearest` (greedy nearest-feasible baseline). Both share the same space-time
  planner; Compare runs both on the identical frozen workload and reports measured results.
- **Inventory visuals (v1.1)**: rack slots render empty; packages render dynamically in their
  slots (pickup slides the item onto the robot; unload stacks crates at the dock). ~62% of
  non-package slots show muted decorative "bulk stock" — clearly not mission inventory.

## Rendering decisions
- PixiJS 8, layered containers: floor (RenderTexture-cached per map revision), racks+static cartons
  (cached), live packages, route overlays, robots, FX, UI overlay. Renderer subscribes to engine
  snapshots; interpolation between ticks in rAF; paused ⇒ no motion.
- Camera: drag-pan, wheel zoom about pointer (0.35×–4×), fit-to-map, minimap. Semantic label density
  by zoom. Cell size 32 world px.
- All art is procedural vector drawing (Graphics → cached textures). No external assets ⇒
  docs/ASSET_CREDITS.md states 100% original procedural art (CC0-by-author).

## UI shape
Single-screen studio: top bar (logo, mode tabs, warehouse selector, save/export), left tool/view
panel, hero canvas, right Mission Planner, bottom timeline. Modes: Design, Plan (mission setup),
Simulate (run/intervene), Analyze, Learn. Overview = landing overlay. Compare = roadmap-labeled in
V1 (no fake algorithm tabs).

## Data
Scenario = JSON {schemaVersion, map, packages, robots, mission}. Autosave to localStorage + manual
export/import file with schema validation. Custom maps derive from a preset.

## Deliberately NOT built in V1 (roadmap)
Nearest-neighbor / auction / exact baselines, CBS, WHCA*, OR-Tools, batteries, physics, 3D.
`PlanningStrategy` interface exists so V2 can add them.
