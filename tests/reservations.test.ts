// Space-time reservation planner: conflicts, head-on swaps, idle blockers, explicit failure.
import { describe, expect, it } from 'vitest';
import { planFleetRobots, type GoalRef } from '../src/engine/reservations';
import { CellType, type WarehouseMapData } from '../src/engine/types';
import { idx } from '../src/engine/grid';

/** 10x4 corridor: row y=1 is the corridor, cells (4,2)+(5,2)+(6,2) form a passing bay/bypass when enabled. */
function corridorMap(withBay: boolean): WarehouseMapData {
  const W = 10;
  const H = 4;
  const cells = new Uint8Array(W * H).fill(CellType.Floor);
  for (let x = 0; x < W; x++) {
    cells[idx({ width: W }, x, 0)] = CellType.Wall;
    for (let y = 2; y < H; y++) cells[idx({ width: W }, x, y)] = CellType.Wall;
  }
  if (withBay) {
    cells[idx({ width: W }, 4, 2)] = CellType.Floor;
    cells[idx({ width: W }, 5, 2)] = CellType.Floor;
    cells[idx({ width: W }, 6, 2)] = CellType.Floor;
  }
  cells[idx({ width: W }, 0, 1)] = CellType.Dock;
  cells[idx({ width: W }, 9, 1)] = CellType.Dock;
  return {
    id: 'corridor',
    name: 'Corridor',
    subtitle: '',
    width: W,
    height: H,
    revision: 1,
    cells,
    zones: [],
    shelfRuns: [],
    trucks: [],
    chargeCells: [],
  };
}

function cellAt(steps: { arriveTick: number; departTick: number; cell: number }[], t: number): number {
  let i = 0;
  while (i + 1 < steps.length && steps[i + 1].arriveTick <= t) i++;
  return steps[i].cell;
}

function assertNoConflicts(plans: ReturnType<typeof planFleetRobots>['plans'], horizon: number): void {
  for (let t = 0; t <= horizon; t++) {
    const seen = new Map<number, string>();
    for (const rp of plans) {
      const c = cellAt(rp.steps, t);
      const owner = seen.get(c);
      expect(owner, `tick ${t}: two robots on cell ${c}`).toBeUndefined();
      seen.set(c, rp.robotId);
    }
    for (const rp of plans) {
      const c0 = cellAt(rp.steps, t);
      const c1 = cellAt(rp.steps, Math.min(t + 1, horizon));
      if (c0 !== c1) {
        for (const other of plans) {
          if (other.robotId === rp.robotId) continue;
          const o0 = cellAt(other.steps, t);
          const o1 = cellAt(other.steps, Math.min(t + 1, horizon));
          expect(`${o0}>${o1}`, `head-on swap at tick ${t}`).not.toBe(`${c1}>${c0}`);
        }
      }
    }
  }
}

describe('space-time reservations', () => {
  it('two robots traveling the same direction stay conflict-free', () => {
    const map = corridorMap(false);
    const robots = [
      { robot: { id: 'R-01', type: 'S1' as const, capacity: 1, homeCell: 11, cell: 11 }, trips: [], carriedCount: 0 },
      { robot: { id: 'R-02', type: 'S1' as const, capacity: 1, homeCell: 13, cell: 13 }, trips: [], carriedCount: 0 },
    ];
    const refs: GoalRef[][] = [
      [{ kind: 'unload', tripIndex: 0, taskIds: ['X'], cell: idx(map, 8, 1) }],
      [{ kind: 'unload', tripIndex: 0, taskIds: ['Y'], cell: idx(map, 9, 1) }],
    ];
    const plan = planFleetRobots(map, [idx(map, 0, 1), idx(map, 9, 1)], robots, refs, 0, []);
    expect(plan.failedRobots).toHaveLength(0);
    assertNoConflicts(plan.plans, 60);
  });

  it('opposing robots cross via a passing bay without sharing a cell or swapping', () => {
    const map = corridorMap(true);
    const robots = [
      { robot: { id: 'R-01', type: 'S1' as const, capacity: 1, homeCell: 11, cell: 11 }, trips: [], carriedCount: 0 },
      { robot: { id: 'R-02', type: 'S1' as const, capacity: 1, homeCell: 18, cell: 18 }, trips: [], carriedCount: 0 },
    ];
    const refs: GoalRef[][] = [
      [{ kind: 'unload', tripIndex: 0, taskIds: ['X'], cell: idx(map, 9, 1) }],
      [{ kind: 'unload', tripIndex: 0, taskIds: ['Y'], cell: idx(map, 0, 1) }],
    ];
    const plan = planFleetRobots(map, [idx(map, 0, 1), idx(map, 9, 1)], robots, refs, 0, []);
    expect(plan.failedRobots).toHaveLength(0);
    assertNoConflicts(plan.plans, 120);
  });

  it('head-on in a bay-less corridor: planning fails explicitly, no fake routes', () => {
    const map = corridorMap(false);
    const robots = [
      { robot: { id: 'R-01', type: 'S1' as const, capacity: 1, homeCell: 11, cell: 11 }, trips: [], carriedCount: 0 },
      { robot: { id: 'R-02', type: 'S1' as const, capacity: 1, homeCell: 18, cell: 18 }, trips: [], carriedCount: 0 },
    ];
    const refs: GoalRef[][] = [
      [{ kind: 'unload', tripIndex: 0, taskIds: ['X'], cell: idx(map, 9, 1) }],
      [{ kind: 'unload', tripIndex: 0, taskIds: ['Y'], cell: idx(map, 0, 1) }],
    ];
    const plan = planFleetRobots(map, [idx(map, 0, 1), idx(map, 9, 1)], robots, refs, 0, []);
    expect(plan.failedRobots.length).toBeGreaterThan(0);
    expect(plan.failedRobots[0].reason).toMatch(/conflict-free route/);
  });

  it('idle robot blocking the corridor is never driven through', () => {
    const map = corridorMap(true);
    const robots = [
      { robot: { id: 'R-01', type: 'S1' as const, capacity: 1, homeCell: 11, cell: 11 }, trips: [], carriedCount: 0 },
    ];
    const idleCell = idx(map, 5, 1);
    const refs: GoalRef[][] = [[{ kind: 'unload', tripIndex: 0, taskIds: ['X'], cell: idx(map, 9, 1) }]];
    const plan = planFleetRobots(map, [idx(map, 0, 1), idx(map, 9, 1)], robots, refs, 0, [{ id: 'idle', cell: idleCell, parkCell: idleCell }]);
    expect(plan.failedRobots).toHaveLength(0);
    for (const s of plan.plans[0].steps) expect(s.cell).not.toBe(idleCell);
  });

  it('two robots converging on one cell are separated in time or space', () => {
    const map = corridorMap(true);
    const robots = [
      { robot: { id: 'R-01', type: 'S1' as const, capacity: 1, homeCell: 11, cell: 11 }, trips: [], carriedCount: 0 },
      { robot: { id: 'R-02', type: 'S1' as const, capacity: 1, homeCell: 13, cell: 13 }, trips: [], carriedCount: 0 },
    ];
    const target = idx(map, 8, 1);
    const refs: GoalRef[][] = [
      [{ kind: 'unload', tripIndex: 0, taskIds: ['A'], cell: target }],
      [{ kind: 'unload', tripIndex: 0, taskIds: ['B'], cell: target }],
    ];
    const plan = planFleetRobots(map, [idx(map, 0, 1), idx(map, 9, 1)], robots, refs, 0, []);
    expect(plan.failedRobots).toHaveLength(0);
    assertNoConflicts(plan.plans, 120);
  });
});
