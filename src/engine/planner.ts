// Mission planning orchestrator: allocation → goal refs → prioritized space-time fleet plan.
// Pure functions; the caller (store) owns scenario state and applies results.
import { DistanceIndex } from './pathfinding';
import { allocateTasks, STRATEGY_ID, STRATEGY_NAME } from './allocation';
import { allocateNearestFeasible, NEAREST_STRATEGY_ID, NEAREST_STRATEGY_NAME } from './allocation-nearest';
import { planFleetRobots, type GoalRef, type FleetEntry } from './reservations';
import { CellType, type PackageData, type PlanResult, type RobotInstance, type WarehouseMapData } from './types';

export interface MissionRequest {
  map: WarehouseMapData;
  dockCells: number[];
  packages: PackageData[]; // all scenario packages (any state except delivered)
  robots: RobotInstance[]; // participating robots (cell = current)
  idleRobotCells: number[]; // cells of non-participating robots
  selectedTaskIds: string[];
  carriedByRobot: Record<string, string[]>;
  startTick: number;
  strategy?: 'insertion' | 'nearest';
}

/**
 * Parking target for an idle robot: stay put unless it stands on a pickup service cell of a
 * selected task or a dock cell — then move to the nearest free walkable cell that blocks nobody.
 */
function parkingCellFor(
  map: WarehouseMapData,
  fromCell: number,
  avoid: Set<number>,
  occupiedByOthers: Set<number>,
): number {
  const isWalk = (c: number) => map.cells[c] === CellType.Floor || map.cells[c] === CellType.Dock;
  if (!avoid.has(fromCell) && !occupiedByOthers.has(fromCell)) return fromCell;
  // BFS outward for the nearest safe cell
  const prev = new Map<number, number>();
  const queue = [fromCell];
  prev.set(fromCell, -1);
  while (queue.length) {
    const c = queue.shift()!;
    if (c !== fromCell && !avoid.has(c) && !occupiedByOthers.has(c) && isWalk(c)) return c;
    const x = c % map.width;
    const y = Math.floor(c / map.width);
    const nb = [x > 0 ? c - 1 : -1, x < map.width - 1 ? c + 1 : -1, y > 0 ? c - map.width : -1, y < map.height - 1 ? c + map.width : -1];
    for (const n of nb) {
      if (n >= 0 && isWalk(n) && !prev.has(n)) {
        prev.set(n, c);
        queue.push(n);
      }
    }
  }
  return fromCell;
}

export interface MissionPlanOutcome {
  plan: PlanResult;
  strategyId: string;
  strategyName: string;
  assignmentNotes: Record<string, string>; // robotId -> explanation
  unassigned: { taskId: string; reason: string }[];
}

export function createMissionPlan(req: MissionRequest): MissionPlanOutcome {
  const packagesById = new Map<string, PackageData>();
  for (const p of req.packages) packagesById.set(p.id, p);

  const pickupCells = req.selectedTaskIds
    .map((id) => packagesById.get(id)?.pickupCell)
    .filter((c): c is number => c !== undefined);
  const dx = new DistanceIndex(req.map);
  dx.ensureScenario(pickupCells, req.dockCells, req.robots.map((r) => r.cell));

  const alloc =
    req.strategy === 'nearest'
      ? allocateNearestFeasible({
          map: req.map,
          dockCells: req.dockCells,
          robots: req.robots,
          packagesById,
          selectedTaskIds: req.selectedTaskIds,
          carriedByRobot: req.carriedByRobot,
          dx,
          startTick: req.startTick,
        })
      : allocateTasks({
          map: req.map,
          dockCells: req.dockCells,
          robots: req.robots,
          packagesById,
          selectedTaskIds: req.selectedTaskIds,
          carriedByRobot: req.carriedByRobot,
          dx,
          startTick: req.startTick,
        });

  const entries: FleetEntry[] = [];
  const refsByRobot: GoalRef[][] = [];
  for (const a of alloc.assignments) {
    const robot = req.robots.find((r) => r.id === a.robotId)!;
    const carried = req.carriedByRobot[robot.id] ?? [];
    const entry: FleetEntry = {
      robot,
      trips: a.trips,
      carriedCount: carried.length > 0 && a.trips[0]?.taskIds.includes(carried[0]) ? carried.length : 0,
    };
    entries.push(entry);
    // Build refs with pickup/dock cells; carried tasks are "already picked" — no pickup goal,
    // but the unload still delivers them (full trip cargo).
    const refs: GoalRef[] = [];
    a.trips.forEach((trip, ti) => {
      const from = ti === 0 ? entry.carriedCount : 0;
      for (let j = from; j < trip.taskIds.length; j++) {
        const p = packagesById.get(trip.taskIds[j])!;
        refs.push({ kind: 'pickup', taskId: p.id, cell: p.pickupCell });
      }
      refs.push({ kind: 'unload', tripIndex: ti, taskIds: trip.taskIds.slice(), cell: trip.dockCell });
    });
    refsByRobot.push(refs);
  }

  // Idle robots make way if they stand on a selected pickup cell or dock cell.
  const selectedPickups = new Set<number>(
    req.selectedTaskIds.map((id) => packagesById.get(id)?.pickupCell).filter((c): c is number => c !== undefined),
  );
  const dockSet = new Set(req.dockCells);
  const allRobotCells = new Set([...req.robots.map((r) => r.cell), ...req.idleRobotCells]);
  const avoid = new Set([...selectedPickups, ...dockSet]);
  const idleRobots: { id: string; cell: number; parkCell: number }[] = [];
  const occupied = new Set(allRobotCells);
  for (const cell of req.idleRobotCells) {
    const park = parkingCellFor(req.map, cell, avoid, occupied);
    idleRobots.push({ id: `idle@${cell}`, cell, parkCell: park });
    occupied.delete(cell);
    occupied.add(park);
  }

  // Preferred: robots return to their home bays after the last unload. If any robot cannot plan
  // with the park leg (contested bay / congestion), fall back to no-park planning so the mission
  // stays runnable; the difference stays visible via parkTick === null on robot plans.
  const fleetArgs = {
    map: req.map,
    dockCells: req.dockCells,
    robots: entries.map((e) => ({ robot: e.robot, trips: e.trips, carriedCount: e.carriedCount })),
    startTick: req.startTick,
    idleRobots,
    estimate: alloc.estimatedMakespanTicks - req.startTick > 0 ? alloc.estimatedMakespanTicks : undefined,
  };
  const refsByRobotWithPark: GoalRef[][] = refsByRobot.map((refs, i) => [
    ...refs,
    { kind: 'park', cell: fleetArgs.robots[i].robot.homeCell },
  ]);
  const withPark = planFleetRobots(
    fleetArgs.map,
    fleetArgs.dockCells,
    fleetArgs.robots,
    refsByRobotWithPark,
    fleetArgs.startTick,
    fleetArgs.idleRobots,
    fleetArgs.estimate,
  );
  let plan = withPark;
  if (withPark.failedRobots.length > 0) {
    const withoutPark = planFleetRobots(
      fleetArgs.map,
      fleetArgs.dockCells,
      fleetArgs.robots,
      refsByRobot,
      fleetArgs.startTick,
      fleetArgs.idleRobots,
      fleetArgs.estimate,
    );
    if (withoutPark.failedRobots.length === 0) plan = withoutPark;
  }

  // Task states: tasks whose robot failed planning are marked unreachable for this run.
  const failedIds = new Set<string>();
  for (const a of alloc.assignments) {
    if (plan.failedRobots.some((f) => f.robotId === a.robotId)) {
      for (const t of a.trips) for (const id of t.taskIds) failedIds.add(id);
    }
  }
  const taskStates: Record<string, 'assigned' | 'unreachable'> = {};
  for (const a of alloc.assignments) {
    for (const t of a.trips) {
      for (const id of t.taskIds) taskStates[id] = failedIds.has(id) ? 'unreachable' : 'assigned';
    }
  }
  plan.taskStates = taskStates;

  const assignmentNotes: Record<string, string> = {};
  for (const a of alloc.assignments) assignmentNotes[a.robotId] = a.note;
  // Annotate robots that failed planning.
  for (const f of plan.failedRobots) {
    assignmentNotes[f.robotId] = `Planning failed: ${f.reason} Tasks stay unassigned.`;
  }

  return {
    plan,
    strategyId: req.strategy === 'nearest' ? NEAREST_STRATEGY_ID : STRATEGY_ID,
    strategyName: req.strategy === 'nearest' ? NEAREST_STRATEGY_NAME : STRATEGY_NAME,
    assignmentNotes,
    unassigned: alloc.unassigned,
  };
}

/** Delivery dock cells of a map (walkable service cells marked Dock). */
export function dockCellsOf(map: WarehouseMapData): number[] {
  const out: number[] = [];
  for (let i = 0; i < map.cells.length; i++) if (map.cells[i] === CellType.Dock) out.push(i);
  return out;
}
