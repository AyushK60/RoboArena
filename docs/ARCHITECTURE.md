# RoboArena - Architecture

## Principle: logic independent of visuals

The deterministic engine (`src/engine/`) is pure TypeScript with **zero** React or PixiJS imports.
It consumes scenarios and missions, produces timed plans, and derives all runtime state from
`(plan, tick)`. The renderer (`src/render/`) and UI (`src/ui/`) are subscribers. Nothing about
framerate, animation, or user input can change a simulation outcome.

```
src/
├── engine/
│   ├── types.ts         domain types (map, packages, robots, plans, snapshots)
│   ├── constants.ts     frozen V1 simulation constants
│   ├── rng.ts           mulberry32 seeded RNG (scenario art variation only)
│   ├── grid.ts          cell geometry, service-cell resolution, scenario validation
│   ├── pathfinding.ts   MinHeap, static A*, BFS fields, DistanceIndex (per map revision)
│   ├── allocation.ts    capacity-aware greedy insertion with makespan bidding + bounded 2-opt
│   ├── reservations.ts  reservation table + space-time A* + prioritized fleet planning
│   ├── planner.ts       orchestrator: allocation → goal refs → fleet plan; idle "make way"
│   └── simulation.ts    tick cursor, event schedule, derived snapshots/metrics
├── scenarios/
│   ├── presets.ts       4 warehouse presets from shared builder primitives
│   └── tiny.ts          deterministic test fixture
├── render/
│   ├── palette.ts       shared color identity (map + CSS)
│   ├── static-art.ts    floor/zones/markings/racks/trucks → cached 2× RenderTexture
│   ├── dynamic-art.ts   robot sprites, package markers, dashed route overlays
│   └── warehouse-renderer.ts  PixiJS app, camera, layers, minimap, pointer input
├── state/store.ts       app store: mode, selection, planning, playback, editor, persistence
├── ui/App.tsx           React shell (top bar, panels, overview, learn, toasts)
└── main.tsx             entry, dev/e2e store hook
tests/                   Vitest suite (engine-only, node environment)
docs/                    architecture, algorithms, design notes, test report, screenshots/
```

## Data flow

1. **Scenario load** - `buildPreset(id)` (or imported JSON) → `AppStore.loadScenario` →
   `Simulation.loadScenario`, validation via `validateScenario`, renderer `setScenario` (static
   art rebuild keyed by `map.revision`).
2. **Plan** - `store.planMission()` → `createMissionPlan()`:
   `DistanceIndex.ensureScenario` → `allocateTasks` (allocator) → per-robot goal refs →
   `planFleetRobots` (prioritized space-time planning; idle robots receive parking goals first) →
   `PlanResult { plans, idlePlans, failedRobots, taskStates, conflictsAvoided, planningMs }`.
3. **Commit** - `Simulation.applyPlan` converts plans into a sorted `ScheduledEvent` list
   (mission_start, pickup, trip_complete, mission_complete, replan, planning_failed). History
   events (tick ≤ current) are preserved across replans; already-delivered tasks move into
   `deliveredRecords` so replanning never un-delivers anything.
4. **Playback** - one rAF loop advances `tickFloat` by `dt × speed`; integer crossings drive
   `Simulation.tickForward()`. Every frame the renderer receives `sim.snapshot(...)` +
   `tickFloat` and interpolates robot positions/rotation; React panels re-render on discrete
   version bumps, and two small live hooks refresh clocks/status at ~7 Hz.
5. **Intervention** - edits allowed in Design mode or while paused in Simulate. Each accepted
   edit bumps `map.revision`, revalidates; `store.replanFromCurrentState()` re-runs allocation +
   space-time planning from robots' current cells at the current tick with `carriedByRobot`
   preserved. Invalid edits roll back (undo stack) with an explanatory toast.

## Determinism guarantees

- All planner decisions (tie-breaks, expansion order, priority permutations, parking BFS) are
  deterministic; there is no RNG in planning. Seeded RNG is used only for scenario art variation.
- `performance.now()` appears only inside planning-time **measurements**, never in decisions.
- Snapshot state (positions, cargo, package states, metrics) is derived from `(plan, tick)` -
  pausing, stepping, and replay cannot desynchronize. Verified by the byte-identical replay test
  and in-browser replay comparison.

## Renderer layering

| Layer | Content | Refresh |
|---|---|---|
| static RT (2×, cached per map revision) | floor, tiles, scuffs, zone tints/labels, safety lines, lane arrows, dock stripes, charging pads, rack cells + cartons + yellow feet, trucks, column/row labels | on map revision change only |
| package markers | corner pip (unselected) or numbered chip (mission tasks) | on plan change / visibility by state |
| routes | dashed polylines + arrowheads + pickup rings + live trail | on tick change |
| robots | chassis/wheels/lidar/LED/cargo/badge, interpolation, dwell rings | every frame |
| overlay | selection brackets, hover cell | every frame |
| screen space | minimap with viewport rect | every frame |

Cell size is 32 world px; the camera supports drag-pan, wheel zoom about the pointer (0.28–4×),
fit-to-map, and a minimap. React never re-renders per frame.

## Persistence

- Scenario JSON: `{ schemaVersion: 1, id, map (cells as array), packages, robots }`; imports are
  schema-validated (dimensions, cell range, robot/package fields) before load.
- Custom layouts live in `localStorage` (`roboarena:custom-scenarios:v1`); exports download as
  files; run exports include scenario + selection + events + metrics.
