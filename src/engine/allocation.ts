// V1 task allocation: capacity-aware greedy cheapest-insertion with makespan bidding.
// This is a documented HEURISTIC - not a global optimum (see docs/ALGORITHM_EXPLANATIONS.md).
//
// For every unassigned task (processed in stable id order) we evaluate inserting it into every
// robot at every feasible (trip, position) - including opening a new trip - and pick the option
// that minimizes the resulting ESTIMATED fleet makespan. Estimates use true aisle distances
// (BFS fields), pickup dwells and dock unload dwells; congestion waits are NOT estimated
// (documented limitation; the reservation planner handles conflicts afterwards).
import { PICKUP_DWELL, UNLOAD_DWELL } from './constants';
import { DistanceIndex, INF } from './pathfinding';
import type { PackageData, RobotInstance, TripPlan, WarehouseMapData, RobotAssignment, AllocationResult } from './types';

export const STRATEGY_ID = 'greedy-insertion-makespan-v1';
export const STRATEGY_NAME = 'Fleet optimization (capacity-aware greedy insertion)';

export interface AllocationContext {
  map: WarehouseMapData;
  dockCells: number[];
  robots: RobotInstance[]; // participating robots only, cell = current cell
  packagesById: Map<string, PackageData>;
  selectedTaskIds: string[]; // tasks to allocate (assigned-but-unpicked + newly selected)
  carriedByRobot: Record<string, string[]>; // cargo already on each robot (stays with robot)
  dx: DistanceIndex;
  startTick: number;
}

interface RobotState {
  robot: RobotInstance;
  trips: TripPlan[];
  carriedCount: number; // number of already-carried tasks in trips[0]
  hasCarried: boolean;
  finish: number;
}

function cloneTrips(trips: TripPlan[]): TripPlan[] {
  return trips.map((t) => ({ taskIds: t.taskIds.slice(), dockCell: t.dockCell }));
}

function nearestDock(
  dx: DistanceIndex,
  from: number,
  dockCells: number[],
): { cell: number; dist: number } | null {
  let best: { cell: number; dist: number } | null = null;
  for (const d of dockCells) {
    const dist = dx.dist(from, d);
    if (dist === INF) continue;
    if (best === null || dist < best.dist) best = { cell: d, dist };
  }
  return best;
}

function estimateFinish(rs: RobotState, ctx: AllocationContext): number {
  let t = ctx.startTick;
  let pos = rs.robot.cell;
  for (let i = 0; i < rs.trips.length; i++) {
    const trip = rs.trips[i];
    const prePicked = i === 0 ? rs.carriedCount : 0;
    for (let j = prePicked; j < trip.taskIds.length; j++) {
      const p = ctx.packagesById.get(trip.taskIds[j])!;
      const d = ctx.dx.dist(pos, p.pickupCell);
      if (d === INF) return INF;
      t += d;
      pos = p.pickupCell;
      t += PICKUP_DWELL;
    }
    const dd = ctx.dx.dist(pos, trip.dockCell);
    if (dd === INF) return INF;
    t += dd;
    pos = trip.dockCell;
    t += UNLOAD_DWELL;
  }
  return t;
}

/** Total trip traversal distance in cells (for 2-opt improvement + explanation stats). */
function tripDistance(rs: RobotState, trip: TripPlan, fromCell: number, ctx: AllocationContext): number {
  let pos = fromCell;
  let total = 0;
  const prePicked = trip === rs.trips[0] ? rs.carriedCount : 0;
  for (let j = prePicked; j < trip.taskIds.length; j++) {
    const p = ctx.packagesById.get(trip.taskIds[j])!;
    total += ctx.dx.dist(pos, p.pickupCell);
    pos = p.pickupCell;
  }
  total += ctx.dx.dist(pos, trip.dockCell);
  return total;
}

export function allocateTasks(ctx: AllocationContext): AllocationResult {
  const t0 = performance.now();
  const carriedSet = new Set<string>();
  for (const ids of Object.values(ctx.carriedByRobot)) for (const id of ids) carriedSet.add(id);

  const robots: RobotState[] = ctx.robots.map((robot) => {
    const carried = ctx.carriedByRobot[robot.id] ?? [];
    const trips: TripPlan[] = [];
    let carriedCount = 0;
    if (carried.length > 0) {
      const nd = nearestDock(ctx.dx, robot.cell, ctx.dockCells);
      trips.push({ taskIds: carried.slice(), dockCell: nd ? nd.cell : ctx.dockCells[0] });
      carriedCount = carried.length;
    }
    const rs: RobotState = { robot, trips, carriedCount, hasCarried: carried.length > 0, finish: 0 };
    rs.finish = estimateFinish(rs, ctx);
    return rs;
  });

  // Robot currently carrying but with NO other task still needs its dock return - keep it.
  const pool = ctx.selectedTaskIds.filter((id) => !carriedSet.has(id)).sort();
  const unassigned: { taskId: string; reason: string }[] = [];

  for (const taskId of pool) {
    const pkg = ctx.packagesById.get(taskId)!;
    let best:
      | { score: number; ri: number; ti: number; pos: number; newTrip: boolean }
      | null = null;

    for (let ri = 0; ri < robots.length; ri++) {
      const rs = robots[ri];
      // Feasibility for this robot (any candidate requires these distances to be finite).
      const dHomePickup = ctx.dx.dist(rs.robot.cell, pkg.pickupCell);
      const dPickupDock = ctx.dx.dist(pkg.pickupCell, ctx.dockCells[0]); // any dock reachability probe
      if (dHomePickup === INF || dPickupDock === INF) continue;

      const otherMax = maxFinishExcluding(robots, ri);

      // Option A: insert into an existing trip with spare capacity.
      for (let ti = 0; ti < rs.trips.length; ti++) {
        const trip = rs.trips[ti];
        if (trip.taskIds.length >= rs.robot.capacity) continue;
        const posLow = ti === 0 ? rs.carriedCount : 0;
        for (let pos = posLow; pos <= trip.taskIds.length; pos++) {
          trip.taskIds.splice(pos, 0, taskId);
          const finish = estimateFinish(rs, ctx);
          trip.taskIds.splice(pos, 1);
          const score = Math.max(finish, otherMax);
          if (
            best === null ||
            score < best.score ||
            (score === best.score && (ri < best.ri || (ri === best.ri && (ti < best.ti || (ti === best.ti && pos < best.pos)))))
          ) {
            best = { score, ri, ti, pos, newTrip: false };
          }
        }
      }

      // Option B: open a new trip.
      if (true) {
        const nd = nearestDock(ctx.dx, pkg.pickupCell, ctx.dockCells);
        if (nd) {
          rs.trips.push({ taskIds: [taskId], dockCell: nd.cell });
          const finish = estimateFinish(rs, ctx);
          rs.trips.pop();
          const score = Math.max(finish, otherMax);
          const ti = rs.trips.length;
          const pos = 0;
          if (
            best === null ||
            score < best.score ||
            (score === best.score && (ri < best.ri || (ri === best.ri && ti < best.ti)))
          ) {
            best = { score, ri, ti, pos, newTrip: true };
          }
        }
      }
    }

    if (best === null) {
      unassigned.push({ taskId, reason: 'No robot can reach this package or its dock.' });
      continue;
    }
    const rs = robots[best.ri];
    if (best.newTrip) {
      const nd = nearestDock(ctx.dx, pkg.pickupCell, ctx.dockCells)!;
      rs.trips.push({ taskIds: [taskId], dockCell: nd.cell });
    } else {
      rs.trips[best.ti].taskIds.splice(best.pos, 0, taskId);
    }
    rs.finish = estimateFinish(rs, ctx);
  }

  // Bounded intra-trip 2-opt (distance metric; single-robot finish is monotone in trip distance).
  for (const rs of robots) {
    for (let ti = 0; ti < rs.trips.length; ti++) {
      improveTripOrder(rs, ti, ctx);
    }
    rs.finish = estimateFinish(rs, ctx);
  }

  const makespan = robots.length ? Math.max(...robots.map((r) => r.finish)) : ctx.startTick;
  const assignments: RobotAssignment[] = robots.map((rs) => {
    const stops = rs.trips.reduce((n, t) => n + t.taskIds.length, 0);
    return {
      robotId: rs.robot.id,
      trips: rs.trips,
      estimatedFinishTicks: rs.finish,
      note:
        rs.trips.length === 0
          ? 'Left idle - assigning work here would not reduce the predicted makespan.'
          : `${rs.trips.length} trip(s), ${stops} task(s), estimated finish ${Math.max(0, rs.finish - ctx.startTick)}s of work`,
    };
  });

  return {
    assignments,
    unassigned,
    estimatedMakespanTicks: makespan,
    strategyId: STRATEGY_ID,
    planningMs: performance.now() - t0,
  };
}

function maxFinishExcluding(robots: RobotState[], ri: number): number {
  let m = 0;
  for (let i = 0; i < robots.length; i++) if (i !== ri && robots[i].finish > m) m = robots[i].finish;
  return m;
}

/** Classic 2-opt on the open path home→pickups→dock; ≤2 sweeps, accept only strict improvements. */
function improveTripOrder(rs: RobotState, ti: number, ctx: AllocationContext): void {
  const trip = rs.trips[ti];
  const prePicked = ti === 0 ? rs.carriedCount : 0;
  const m = trip.taskIds.length - prePicked;
  if (m < 3) return;
  const fromCell = rs.robot.cell;
  for (let sweep = 0; sweep < 2; sweep++) {
    let improved = false;
    for (let i = prePicked; i < trip.taskIds.length - 1; i++) {
      for (let j = i + 1; j < trip.taskIds.length; j++) {
        const prev = i <= prePicked ? fromCell : ctx.packagesById.get(trip.taskIds[i - 1])!.pickupCell;
        const next =
          j + 1 < trip.taskIds.length
            ? ctx.packagesById.get(trip.taskIds[j + 1])!.pickupCell
            : trip.dockCell;
        const a = ctx.packagesById.get(trip.taskIds[i])!.pickupCell;
        const b = ctx.packagesById.get(trip.taskIds[j])!.pickupCell;
        const removed = ctx.dx.dist(prev, a) + ctx.dx.dist(b, next);
        const added = ctx.dx.dist(prev, b) + ctx.dx.dist(a, next);
        if (added < removed) {
          // reverse segment [i..j]
          const seg = trip.taskIds.slice(i, j + 1).reverse();
          trip.taskIds.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
}
