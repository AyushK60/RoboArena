// Baseline allocation strategy: greedy nearest-feasible.
// Each robot repeatedly takes its nearest reachable unassigned pickup (true aisle distance),
// filling its current dock-to-dock trip up to capacity; a full trip is closed (returns to dock)
// and a new one opens on the next pass. Deterministic: ties break by task id. It deliberately
// ignores makespan balancing - it exists as a simple, well-defined baseline to compare against
// the insertion strategy. Same dwell assumptions and the same space-time planner afterwards.
import { PICKUP_DWELL, UNLOAD_DWELL } from './constants';
import { DistanceIndex, INF } from './pathfinding';
import type { PackageData, RobotInstance, TripPlan, WarehouseMapData, RobotAssignment, AllocationResult } from './types';

export const NEAREST_STRATEGY_ID = 'greedy-nearest-feasible-v1';
export const NEAREST_STRATEGY_NAME = 'Greedy nearest-feasible (baseline)';

export interface AllocationContext {
  map: WarehouseMapData;
  dockCells: number[];
  robots: RobotInstance[];
  packagesById: Map<string, PackageData>;
  selectedTaskIds: string[];
  carriedByRobot: Record<string, string[]>;
  dx: DistanceIndex;
  startTick: number;
}

interface WorkingState {
  robot: RobotInstance;
  trips: TripPlan[];
  carriedCount: number;
  pos: number;
  finish: number;
}

function nearestDock(dx: DistanceIndex, from: number, dockCells: number[]): { cell: number; dist: number } | null {
  let best: { cell: number; dist: number } | null = null;
  for (const d of dockCells) {
    const dist = dx.dist(from, d);
    if (dist === INF) continue;
    if (best === null || dist < best.dist) best = { cell: d, dist };
  }
  return best;
}

function estimateFinish(ws: WorkingState, ctx: AllocationContext): number {
  let t = ctx.startTick;
  let pos = ws.robot.cell;
  for (let i = 0; i < ws.trips.length; i++) {
    const trip = ws.trips[i];
    const prePicked = i === 0 ? ws.carriedCount : 0;
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

export function allocateNearestFeasible(ctx: AllocationContext): AllocationResult {
  const t0 = performance.now();
  const carriedSet = new Set<string>();
  for (const ids of Object.values(ctx.carriedByRobot)) for (const id of ids) carriedSet.add(id);

  const work: WorkingState[] = ctx.robots.map((robot) => {
    const carried = ctx.carriedByRobot[robot.id] ?? [];
    const trips: TripPlan[] = [];
    let carriedCount = 0;
    if (carried.length > 0) {
      const nd = nearestDock(ctx.dx, robot.cell, ctx.dockCells);
      trips.push({ taskIds: carried.slice(), dockCell: nd ? nd.cell : ctx.dockCells[0] });
      carriedCount = carried.length;
    }
    const ws: WorkingState = { robot, trips, carriedCount, pos: robot.cell, finish: 0 };
    ws.finish = estimateFinish(ws, ctx);
    return ws;
  });

  const pool = new Set(ctx.selectedTaskIds.filter((id) => !carriedSet.has(id)).sort());
  const unassigned: { taskId: string; reason: string }[] = [];

  // Interleaved passes keep the fleet busy: each pass gives every robot one pickup.
  let progress = true;
  while (pool.size > 0 && progress) {
    progress = false;
    for (const ws of work) {
      if (pool.size === 0) break;
      const open = ws.trips[ws.trips.length - 1];
      const tripFull = !!open && open.taskIds.length >= ws.robot.capacity;
      if (!open || tripFull) {
        // (re)open a dock-to-dock trip
        if (open && tripFull) ws.pos = open.dockCell;
        const nd = nearestDock(ctx.dx, ws.pos, ctx.dockCells);
        ws.trips.push({ taskIds: [], dockCell: nd ? nd.cell : ctx.dockCells[0] });
      }
      const open2 = ws.trips[ws.trips.length - 1];
      // nearest reachable task from the current position (ties by id)
      let best: { id: string; d: number } | null = null;
      for (const id of pool) {
        const p = ctx.packagesById.get(id)!;
        const d = ctx.dx.dist(ws.pos, p.pickupCell);
        if (d === INF) continue;
        const backDock = nearestDock(ctx.dx, p.pickupCell, ctx.dockCells);
        if (!backDock) continue;
        if (best === null || d < best.d) best = { id, d };
      }
      if (!best) continue;
      pool.delete(best.id);
      open2.taskIds.push(best.id);
      ws.pos = ctx.packagesById.get(best.id)!.pickupCell;
      progress = true;
    }
  }
  // drop empty trailing trips, report leftovers
  for (const ws of work) {
    while (ws.trips.length > 0 && ws.trips[ws.trips.length - 1].taskIds.length === ws.carriedCount && ws.trips.length > 1) {
      // keep trips that at least deliver carried cargo
      if (ws.trips[ws.trips.length - 1].taskIds.length > 0) break;
      ws.trips.pop();
    }
    ws.trips.forEach((t) => {
      if (t.taskIds.length === 0 && !(ws.carriedCount > 0 && t === ws.trips[0])) t.taskIds.length = 0;
    });
    ws.finish = estimateFinish(ws, ctx);
  }
  for (const id of pool) unassigned.push({ taskId: id, reason: 'No robot can reach this package or its dock.' });

  // trim empty trips
  for (const ws of work) {
    ws.trips = ws.trips.filter(
      (t, i) => t.taskIds.length > 0 || (i === 0 && ws.carriedCount > 0),
    );
  }

  const makespan = work.length ? Math.max(...work.map((r) => r.finish)) : ctx.startTick;
  const assignments: RobotAssignment[] = work.map((ws) => {
    const stops = ws.trips.reduce((n, t) => n + t.taskIds.length, 0);
    return {
      robotId: ws.robot.id,
      trips: ws.trips,
      estimatedFinishTicks: ws.finish,
      note:
        ws.trips.length === 0
          ? 'Left idle - the nearest-feasible baseline assigned no reachable work here.'
          : `${ws.trips.length} trip(s), ${stops} task(s), estimated finish ${Math.max(0, ws.finish - ctx.startTick)}s of work`,
    };
  });

  return {
    assignments,
    unassigned,
    estimatedMakespanTicks: makespan,
    strategyId: NEAREST_STRATEGY_ID,
    planningMs: performance.now() - t0,
  };
}
