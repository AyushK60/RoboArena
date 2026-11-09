// Multi-robot collision avoidance: prioritized space-time A* with a reservation table.
//
// Reservations:
//  - vertex (cell, tick): a robot occupies a cell during [arriveTick, departTick] inclusive.
//  - directed edge (from→to, departTick): reserved when leaving `from`; the reverse edge at the
//    same tick counts as occupied too, which makes head-on swaps impossible.
// Wait actions are first-class moves. Idle robots and finished robots are "reserved forever".
// Planning can fail — that is reported, never faked (prioritized planning is incomplete by nature).
import { MOVE_TICKS, PICKUP_DWELL, UNLOAD_DWELL, PLANNING_HORIZON, MAX_LEG_EXPANSIONS, PRIORITY_ATTEMPTS } from './constants';
import { DIRS, isWalkable, manhattan, xOf, yOf } from './grid';
import { MinHeap } from './pathfinding';
import type { PathStep, PlanResult, RobotData, RobotInstance, RobotPlan, TripPlan, WarehouseMapData } from './types';

const T_MOD = 4096; // max planning horizon packed into low bits

export class ReservationTable {
  private vertex = new Map<number, Set<number>>(); // cell -> ticks occupied
  private edges = new Map<number, Set<number>>(); // edgeKey -> depart ticks
  private forever = new Map<number, number>(); // cell -> reserved from tick (inclusive) onwards

  constructor(private map: WarehouseMapData, public horizon: number) {}

  private eKey(from: number, to: number): number {
    return from * this.map.cells.length + to;
  }

  canSit(cell: number, tick: number): boolean {
    const f = this.forever.get(cell);
    if (f !== undefined && tick >= f) return false;
    const s = this.vertex.get(cell);
    return !s || !s.has(tick);
  }

  canSitRange(cell: number, fromTick: number, toTick: number): boolean {
    for (let t = fromTick; t <= toTick; t++) if (!this.canSit(cell, t)) return false;
    return true;
  }

  canMove(from: number, to: number, departTick: number): boolean {
    if (!this.canSit(to, departTick + MOVE_TICKS)) return false;
    const s = this.edges.get(this.eKey(from, to));
    if (s && s.has(departTick)) return false;
    const rs = this.edges.get(this.eKey(to, from));
    if (rs && rs.has(departTick)) return false;
    return true;
  }

  sit(cell: number, fromTick: number, toTick: number): void {
    for (let t = fromTick; t <= toTick; t++) this.addVertex(cell, t);
  }

  move(from: number, to: number, departTick: number): void {
    this.addVertex(from, departTick);
    this.addVertex(to, departTick + MOVE_TICKS);
    const ek = this.eKey(from, to);
    let s = this.edges.get(ek);
    if (!s) {
      s = new Set();
      this.edges.set(ek, s);
    }
    s.add(departTick);
  }

  sitForever(cell: number, fromTick: number): void {
    const f = this.forever.get(cell);
    if (f === undefined || fromTick < f) this.forever.set(cell, fromTick);
  }

  parkRobot(cell: number, startTick: number): void {
    this.sitForever(cell, startTick);
  }

  private addVertex(cell: number, tick: number): void {
    let s = this.vertex.get(cell);
    if (!s) {
      s = new Set();
      this.vertex.set(cell, s);
    }
    s.add(tick);
  }
}

interface LegGoal {
  cell: number;
  dwell: number;
}

interface LegPlanResult {
  steps: PathStep[];
  endTick: number;
  endCell: number;
  goalEndTicks: number[]; // completion tick (arrival+dwell) per goal, same order
}

/**
 * Plan a robot through a sequence of goals (pickup/dwell … dock/dwell) with space-time A*.
 * Dwell is range-checked before accepting a goal arrival — the robot only "lands" on a goal if it
 * can hold the cell for the whole dwell; otherwise the search keeps looking (e.g. arrive later).
 */
export function spacetimePlanLegs(
  map: WarehouseMapData,
  startCell: number,
  startTick: number,
  goals: LegGoal[],
  res: ReservationTable,
  maxExpansions = MAX_LEG_EXPANSIONS,
): LegPlanResult | null {
  if (!isWalkable(map, startCell)) return null;
  let curCell = startCell;
  let curTick = startTick;
  const allSteps: PathStep[] = [];
  const goalEndTicks: number[] = [];

  for (const goal of goals) {
    const leg = spacetimeAStar(map, curCell, curTick, goal, res, maxExpansions);
    if (!leg) return null;
    const firstNew = leg.steps[0];
    if (allSteps.length > 0 && firstNew && firstNew.cell === curCell && firstNew.arriveTick === curTick) {
      const last = allSteps[allSteps.length - 1];
      last.departTick = firstNew.departTick;
      for (let i = 1; i < leg.steps.length; i++) allSteps.push(leg.steps[i]);
    } else {
      for (const s of leg.steps) allSteps.push(s);
    }
    curCell = goal.cell;
    curTick = leg.endTick;
    goalEndTicks.push(leg.endTick);
  }
  return { steps: allSteps, endTick: curTick, endCell: curCell, goalEndTicks };
}

export function spacetimeAStar(
  map: WarehouseMapData,
  startCell: number,
  startTick: number,
  goal: LegGoal,
  res: ReservationTable,
  maxExpansions: number,
): { steps: PathStep[]; endTick: number } | null {
  // The start state may carry the robot's own reservation from the previous leg (its dwell ends
  // exactly at startTick). No other robot can hold (startCell, startTick) — leg dwell ranges were
  // range-checked when accepted — so the start state is always exempt from canSit.
  if (startCell === goal.cell) {
    let depart = startTick + goal.dwell;
    if (depart <= res.horizon && res.canSitRange(startCell, startTick + 1, depart)) {
      res.sit(startCell, startTick, depart);
      return {
        steps: [{ cell: startCell, arriveTick: startTick, departTick: depart, wait: false }],
        endTick: depart,
      };
    }
    return null;
  }

  const key = (cell: number, tick: number) => cell * T_MOD + tick;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, { cell: number; tick: number }>();
  const closed = new Set<number>();
  const heap = new MinHeap();
  let counter = 0;
  const startKey = key(startCell, startTick);
  gScore.set(startKey, 0);
  heap.push(startKey, manhattan(map, startCell, goal.cell) * 1048576 + counter++);

  let expansions = 0;
  while (heap.length > 0) {
    const packed = heap.pop()!;
    const cell = Math.floor(packed / T_MOD);
    const tick = packed % T_MOD;
    const ck = key(cell, tick);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expansions++;
    if (expansions > maxExpansions) return null;
    if (tick >= res.horizon) continue;

    if (cell === goal.cell) {
      let depart = tick + goal.dwell;
      if (depart > res.horizon) continue; // cannot complete dwell within horizon here
      if (!res.canSitRange(cell, tick + 1, depart)) continue; // try arriving later instead
      // Reconstruct path of (cell,tick) states.
      const states: { cell: number; tick: number }[] = [];
      let c: { cell: number; tick: number } | undefined = { cell, tick };
      while (c) {
        states.push(c);
        c = cameFrom.get(key(c.cell, c.tick));
      }
      states.reverse();
      const steps: PathStep[] = [];
      let prev: { cell: number; tick: number } | null = null;
      for (const st of states) {
        if (prev === null) {
          steps.push({ cell: st.cell, arriveTick: st.tick, departTick: st.tick, wait: false });
        } else if (st.cell === prev.cell) {
          const last = steps[steps.length - 1];
          last.departTick = st.tick;
          last.wait = true;
        } else {
          steps.push({ cell: st.cell, arriveTick: st.tick, departTick: st.tick, wait: false });
        }
        prev = st;
      }
      const last = steps[steps.length - 1];
      last.departTick = depart;
      // Commit the whole path into the reservation table: every cell-occupancy interval and
      // every directed move (which also blocks reverse moves = head-on swaps).
      res.sit(steps[0].cell, steps[0].arriveTick, steps[0].departTick);
      for (let i = 1; i < steps.length; i++) {
        res.move(steps[i - 1].cell, steps[i].cell, steps[i - 1].departTick);
        res.sit(steps[i].cell, steps[i].arriveTick, steps[i].departTick);
      }
      return { steps, endTick: depart };
    }

    const g = gScore.get(ck)!;
    const cx = xOf(map, cell);
    const cy = yOf(map, cell);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d].dx;
      const ny = cy + DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (!isWalkable(map, ni)) continue;
      const nt = tick + MOVE_TICKS;
      if (nt > res.horizon) continue;
      if (!res.canMove(cell, ni, tick)) continue;
      const nk = key(ni, nt);
      if (closed.has(nk)) continue;
      const ng = g + MOVE_TICKS;
      const old = gScore.get(nk);
      if (old === undefined || ng < old) {
        gScore.set(nk, ng);
        cameFrom.set(nk, { cell, tick });
        heap.push(nk, (ng + manhattan(map, ni, goal.cell)) * 1048576 + counter++);
      }
    }
    const wt = tick + 1;
    if (wt <= res.horizon && res.canSit(cell, wt)) {
      const wk = key(cell, wt);
      if (!closed.has(wk)) {
        const ng = g + 1;
        const old = gScore.get(wk);
        if (old === undefined || ng < old) {
          gScore.set(wk, ng);
          cameFrom.set(wk, { cell, tick });
          heap.push(wk, (ng + manhattan(map, cell, goal.cell)) * 1048576 + counter++);
        }
      }
    }
  }
  return null;
}

export interface FleetEntry {
  robot: RobotInstance;
  trips: TripPlan[];
  carriedCount: number;
}

export interface PickupGoalRef {
  kind: 'pickup';
  taskId: string;
  cell: number;
}
export interface UnloadGoalRef {
  kind: 'unload';
  tripIndex: number;
  taskIds: string[];
  cell: number;
}
export interface ParkGoalRef {
  kind: 'park';
  cell: number; // robot home bay
}
export type GoalRef = PickupGoalRef | UnloadGoalRef | ParkGoalRef;

/** Public entry: plan a fleet where each robot's goals come from refs (pickup cells + docks). */
export function planFleetRobots(
  map: WarehouseMapData,
  dockCells: number[],
  robots: { robot: RobotInstance; trips: TripPlan[]; carriedCount: number }[],
  refsByRobot: GoalRef[][],
  startTick: number,
  idleRobots: { id: string; cell: number; parkCell: number }[],
  estimatedTicks?: number,
): PlanResult {
  const t0 = performance.now();
  let totalStops = 0;
  for (const refs of refsByRobot) totalStops += refs.filter((r) => r.kind === 'pickup').length;
  // Prefer the allocator's makespan estimate (true aisle distances); fall back to a stop-count bound.
  const estimate = estimatedTicks ?? startTick + totalStops * 22 + robots.length * 40;
  const horizon = Math.min(
    PLANNING_HORIZON,
    Math.max(150, Math.floor(startTick + estimate * 1.7) + 120),
  );

  // Ensure distinct final docks: keep each robot's planned dock unless another robot already
  // claimed the same cell; only the colliding robot is moved to the nearest free dock.
  const finalDocks = new Map<string, number>();
  const taken = new Set<number>();
  robots.forEach((entry, i) => {
    const refs = refsByRobot[i];
    const lastUnload = [...refs].reverse().find((r) => r.kind === 'unload') as UnloadGoalRef | undefined;
    if (!lastUnload) return;
    if (!taken.has(lastUnload.cell)) {
      finalDocks.set(entry.robot.id, lastUnload.cell);
      taken.add(lastUnload.cell);
      return;
    }
    let best: { cell: number; dist: number } | null = null;
    for (const d of dockCells) {
      if (taken.has(d)) continue;
      const dist = manhattan(map, lastUnload.cell, d) * 1000 + d;
      if (best === null || dist < best.dist) best = { cell: d, dist };
    }
    if (best) {
      finalDocks.set(entry.robot.id, best.cell);
      lastUnload.cell = best.cell;
      taken.add(best.cell);
    }
  });

  const base = robots.map((_, i) => i);
  const attempts: number[][] = [base, base.slice().reverse()];
  for (let k = 1; attempts.length < PRIORITY_ATTEMPTS; k++) {
    const rot = base.slice();
    for (let s = 0; s < k; s++) rot.push(rot.shift()!);
    attempts.push(rot);
  }

  let best: { plans: RobotPlan[]; failed: { robotId: string; reason: string }[]; conflicts: number; idlePlans?: { robotId: string; steps: PathStep[] }[] } | null = null;

  for (const order of attempts) {
    const res = new ReservationTable(map, horizon);
    const plans: RobotPlan[] = [];
    const idlePlans: { robotId: string; steps: PathStep[] }[] = [];
    // Idle robots move first (highest priority): clear pickup service cells, then hold position.
    for (const idle of idleRobots) {
      if (idle.parkCell === idle.cell) {
        res.parkRobot(idle.cell, startTick);
        idlePlans.push({
          robotId: idle.id,
          steps: [{ cell: idle.cell, arriveTick: startTick, departTick: horizon, wait: false }],
        });
        continue;
      }
      const leg = spacetimeAStar(map, idle.cell, startTick, { cell: idle.parkCell, dwell: 0 }, res, MAX_LEG_EXPANSIONS);
      if (leg) {
        idlePlans.push({ robotId: idle.id, steps: leg.steps });
        res.sitForever(idle.parkCell, leg.endTick);
      } else {
        // Could not reach a parking spot — hold position (its cell stays blocked; honest).
        res.parkRobot(idle.cell, startTick);
        idlePlans.push({
          robotId: idle.id,
          steps: [{ cell: idle.cell, arriveTick: startTick, departTick: horizon, wait: false }],
        });
      }
    }
    const failed: { robotId: string; reason: string }[] = [];
    let conflicts = 0;
    let allOk = true;

    for (const ri of order) {
      const entry = robots[ri];
      const refs = refsByRobot[ri];
      if (refs.length === 0) {
        res.parkRobot(entry.robot.cell, startTick);
        plans.push({
          robotId: entry.robot.id,
          steps: [{ cell: entry.robot.cell, arriveTick: startTick, departTick: horizon, wait: false }],
          finishTick: startTick,
          parkTick: null,
          pickupEvents: [],
          unloadEvents: [],
          dwellSteps: [],
        });
        continue;
      }
      const goals: LegGoal[] = refs.map((r) => ({
        cell: r.cell,
        dwell: r.kind === 'pickup' ? PICKUP_DWELL : r.kind === 'unload' ? UNLOAD_DWELL : 0,
      }));
      const planned = spacetimePlanLegs(map, entry.robot.cell, startTick, goals, res);
      if (!planned) {
        failed.push({
          robotId: entry.robot.id,
          reason: 'No conflict-free route found (congestion or planning horizon exceeded).',
        });
        allOk = false;
        continue;
      }
      const pickupEvents: { tick: number; taskId: string; cell: number }[] = [];
      const unloadEvents: { tick: number; taskIds: string[]; cell: number; tripIndex: number }[] = [];
      let parkTick: number | null = null;
      planned.goalEndTicks.forEach((tick, gi) => {
        const ref = refs[gi];
        if (ref.kind === 'pickup') pickupEvents.push({ tick, taskId: ref.taskId, cell: ref.cell });
        else if (ref.kind === 'unload') unloadEvents.push({ tick, taskIds: ref.taskIds, cell: ref.cell, tripIndex: ref.tripIndex });
        else parkTick = tick;
      });
      // The robot stays at its final cell after the last leg — block it for later-planned robots.
      res.sitForever(planned.endCell, planned.endTick);
      const finishTick = unloadEvents.length ? unloadEvents[unloadEvents.length - 1].tick : planned.endTick;
      for (const s of planned.steps) if (s.wait) conflicts++;
      // Annotate which steps are goal dwells (for runtime state derivation).
      const dwellSteps: { stepIndex: number; kind: 'pickup' | 'unload' }[] = [];
      planned.goalEndTicks.forEach((gtick, gi) => {
        const ref = refs[gi];
        if (ref.kind === 'park') return;
        const idx = planned.steps.findIndex((s) => s.cell === ref.cell && s.departTick === gtick);
        if (idx >= 0) dwellSteps.push({ stepIndex: idx, kind: ref.kind === 'pickup' ? 'pickup' : 'unload' });
      });
      plans.push({
        robotId: entry.robot.id,
        steps: planned.steps,
        finishTick,
        parkTick,
        pickupEvents,
        unloadEvents,
        dwellSteps,
      });
    }

    if (allOk || best === null) {
      best = { plans, failed, conflicts, idlePlans };
      if (allOk) break;
    }
  }

  let estimatedMakespan = startTick;
  for (const p of best!.plans) {
    const f = p.unloadEvents.length ? p.unloadEvents[p.unloadEvents.length - 1].tick : startTick;
    if (f > estimatedMakespan) estimatedMakespan = f;
  }

  return {
    plans: best!.plans,
    idlePlans: best!.idlePlans ?? [],
    failedRobots: best!.failed,
    taskStates: {},
    estimatedMakespanTicks: estimatedMakespan,
    planningMs: performance.now() - t0,
    conflictsAvoided: best!.conflicts,
  };
}
