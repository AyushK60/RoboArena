# RoboArena - Algorithm explanations and honest limitations

## 1. Routing: A* on the warehouse graph

- The warehouse is a 4-connected grid of floor/dock (walkable) and rack/obstacle/wall (blocked)
  cells. Robots traverse **aisles only**; a package's pickup happens at an adjacent walkable
  *service cell*, never inside a rack.
- A* uses the Manhattan heuristic - admissible and consistent for unit-cost orthogonal moves -
  with deterministic neighbor order (N, E, S, W) and FIFO tie-breaking. Unreachable goals return
  an explicit failure; no straight-line fallback exists.
- The allocator needs pairwise distances among pickups, docks, and robot cells. Uniform costs let
  BFS produce exact fields, cached per source in `DistanceIndex` and keyed by map revision; edits
  invalidate the cache. (A* vs BFS agreement is asserted by tests.)

## 2. Task allocation: capacity-aware greedy insertion with makespan bidding

**Objective.** Minimize the *predicted makespan* - the time at which the last robot finishes
(unloads) - not total distance, and not an equal split of tasks.

**Mechanic.** For each unassigned task (stable id order), evaluate inserting it into every robot
at every feasible (trip, position) - a trip is a dock-to-dock sequence with per-trip capacity
(S1 ≤ 1, H10 ≤ 10) - plus the option of opening a new trip. Each candidate is scored by the
resulting estimated global makespan:

```
estimate(robot) = Σ over trips [ Σ d(cell → pickup) + PICKUP_DWELL ] + d(last pickup → dock) + UNLOAD_DWELL
score(candidate) = max(estimate(robot) after insertion, max estimate of other robots)
```

The lowest-scoring candidate wins; ties break deterministically by (robot index, trip index,
position). Already-carried cargo stays with its carrier (it must be delivered) and may be
extended if capacity remains. A bounded 2-opt pass (≤ 2 sweeps) then improves intra-trip pickup
order using the same distance metric.

**Observable consequences** (all demonstrated by tests and the UI):
- The H10 naturally takes multi-package trips (e.g., 11 tasks over 2 trips) while the S1 takes
  singles (4 tasks over 4 trips) - with *different* tasks in general, since insertion is
  cost-based rather than a hardcoded split.
- A robot may remain **idle** when assigning work to it would not reduce the predicted makespan.
- More selected tasks than total instantaneous capacity still complete via repeat dock trips.

**Honesty.** This is a heuristic. Greedy insertion without backtracking gives no optimality
guarantee; the UI labels it "heuristic (not proven optimal)". The estimate also ignores
congestion waits - the space-time planner resolves real conflicts afterwards, which is exactly
why planned vs actual makespan can differ (both are reported separately).

## 3. Collision avoidance: prioritized space-time A* with reservations

- **Reservation table** over (cell, tick) vertices and (from→to, departTick) directed edges.
  Reserving both directions of an edge at the same tick makes head-on swaps impossible.
- Robots are planned sequentially in a priority order; each robot's full mission (pickups with
  3-tick dwells, dock unload with 6-tick dwell, between trips) is planned leg-by-leg with
  waits as first-class actions. Dwell ranges are checked before a goal arrival is accepted, so a
  robot "lands" on a pickup only if it can hold the cell for the whole dwell - otherwise it
  arrives later.
- **Idle robots make way**: if an idle robot stands on a selected task's pickup service cell or a
  dock cell, it receives a short parking move (highest planning priority) to the nearest cell
  that blocks nobody, then holds position. This was introduced because a parked robot on a
  pickup cell otherwise makes that task genuinely unreachable.
- **Finished robots and idle robots are reserved for the remaining horizon** ("reserved forever"),
  and final dock cells are de-duplicated so two robots cannot claim the same finishing cell.
- **Bounded retries**: deterministic priority orders (identity, reverse, rotations) are retried;
  a robot that fails in every attempt is reported as `planning failed` and its tasks become
  explicitly unassigned - the rest of the fleet still receives a safe plan. No silent overlap is
  ever permitted.
- **Known incompleteness** (verified by a dedicated test): two opposing robots in a 1-wide
  corridor with no passing bay cannot be planned - prioritized planning reports failure. This is
  the honest answer; MAPF optimality/completeness is not claimed.

## 4. Replanning and interventions

- Structural edits are accepted only while paused or in Design mode. Committing an edit bumps the
  map revision, revalidates the geometry (robots on legal cells, pickups walkable and connected
  to docks), and rolls back with an explanation when invalid.
- On replan: delivered tasks stay delivered (preserved in `deliveredRecords`), carried cargo stays
  with its carrier (and appears in the carrier's first trip), and all remaining tasks are
  re-allocated and re-planned from robots' **current cells at the current tick**. Nothing
  teleports; the plan's routes start at the robots' present positions.
- Reset/replay is a distinct, clearly separate operation that restores the full initial scenario
  and re-plans from tick 0.

## 5. Metrics

- **Makespan (actual)** = tick of the last dock unload. **Planned makespan** = the space-time
  plan's final unload tick. Reported separately, never conflated.
- **Distance** = executed moves × 2 m (1 cell = 2 m, simulated meters - not real-world claims).
- **Waiting** = ticks spent in planner-inserted wait steps, per robot and fleet-wide.
- **Planned waits (conflicts avoided)** counts real wait actions the reservation planner inserted
  to resolve would-be conflicts. When the planner needed no waits, the number is honestly 0
  (no invented statistic).
- **Planning time** = wall-clock milliseconds of the planner on this machine, measured separately
  from simulated time.

## 6. Reserved for future versions

The `PlanningStrategy` seam (allocation → refs → fleet plan) is designed so V2 can add
nearest-neighbor, auction/balanced assignment, richer local search, and exact tiny-instance
baselines, and V3 can add CBS/ECBS and VRP solvers - compared on identical
map/tasks/seed/fleet. None of these exist in V1; the UI says so explicitly.
