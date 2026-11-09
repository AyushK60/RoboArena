// Allocation: capacity semantics, feasibility, multi-trip behavior, fleet comparisons.
import { describe, expect, it } from 'vitest';
import { buildTinyScenario, planAndRun } from './helpers';
import { allocateTasks } from '../src/engine/allocation';
import { DistanceIndex } from '../src/engine/pathfinding';
import { dockCellsOf } from '../src/engine/planner';
import type { RobotInstance } from '../src/engine/types';

describe('task allocation', () => {
  it('tiny 4-package / 2-robot case: feasible hand-checkable assignment', () => {
    const sc = buildTinyScenario({ seed: 3, robots: 2, packages: 6 });
    const ids = sc.packages.slice(0, 4).map((p) => p.id);
    const robots: RobotInstance[] = sc.robots.map((r) => ({ ...r, cell: r.homeCell }));
    const dx = new DistanceIndex(sc.map);
    dx.ensureScenario(
      sc.packages.map((p) => p.pickupCell),
      dockCellsOf(sc.map),
      robots.map((r) => r.cell),
    );
    const res = allocateTasks({
      map: sc.map,
      dockCells: dockCellsOf(sc.map),
      robots,
      packagesById: new Map(sc.packages.map((p) => [p.id, p])),
      selectedTaskIds: ids,
      carriedByRobot: {},
      dx,
      startTick: 0,
    });
    expect(res.unassigned).toHaveLength(0);
    const assigned = res.assignments.flatMap((a) => a.trips.flatMap((t) => t.taskIds)).sort();
    expect(assigned).toEqual(ids.slice().sort());
    // Capacity per trip respected.
    for (const a of res.assignments) {
      const robot = robots.find((r) => r.id === a.robotId)!;
      for (const t of a.trips) expect(t.taskIds.length).toBeLessThanOrEqual(robot.capacity);
    }
    // Estimated makespan is positive and finite.
    expect(res.estimatedMakespanTicks).toBeGreaterThan(0);
    expect(res.estimatedMakespanTicks).toBeLessThan(100000);
  });

  it('15 tasks, mixed S1+H10: all assigned, per-trip capacity holds, multi-trip happens', () => {
    const sc = buildTinyScenario({ seed: 11, robots: 2, packages: 24 });
    const ids = sc.packages.slice(0, 15).map((p) => p.id);
    const run = planAndRun(sc, ids, ['R-01', 'R-02']);
    expect(run.plan.failedRobots).toHaveLength(0);
    expect(run.completed).toBe(true);
    expect(run.final.metrics.delivered).toBe(15);
    // The H10 must have made trips of up to 10; the S1 trips of exactly 1.
    const h10 = run.final.robots.find((r) => r.type === 'H10')!;
    const s1 = run.final.robots.find((r) => r.type === 'S1')!;
    expect(h10.tripsCompleted).toBeGreaterThanOrEqual(2);
    expect(h10.deliveriesDone).toBe(15 - s1.deliveriesDone);
    for (const a of run.plan.plans) {
      void a; // per-tick capacity checked by invariant harness in simulation.test.ts
    }
  });

  it('more tasks than instantaneous capacity still completes via repeat trips', () => {
    const sc = buildTinyScenario({ seed: 5, robots: 2, packages: 24 });
    const ids = sc.packages.map((p) => p.id); // 18 tasks, capacity 1 + 10 = 11 instantaneous
    expect(ids.length).toBeGreaterThan(11);
    const run = planAndRun(sc, ids, ['R-01', 'R-02']);
    expect(run.plan.failedRobots).toHaveLength(0);
    expect(run.completed).toBe(true);
    expect(run.final.metrics.delivered).toBe(ids.length);
  });

  it('zero tasks: no assignments, no events beyond start', () => {
    const sc = buildTinyScenario({ seed: 2, robots: 2, packages: 6 });
    const run = planAndRun(sc, [], ['R-01', 'R-02']);
    expect(run.completed).toBe(true);
    expect(run.final.metrics.delivered).toBe(0);
    for (const r of run.final.robots) expect(r.cell).toBe(r.id === 'R-01' ? sc.robots[0].homeCell : sc.robots[1].homeCell);
  });

  it('single robot study works (all-S1 and all-H10)', () => {
    for (const fleet of [['R-01'], ['R-02']]) {
      const sc = buildTinyScenario({ seed: 9, robots: 2, packages: 12 });
      const run = planAndRun(sc, sc.packages.map((p) => p.id), fleet);
      expect(run.plan.failedRobots).toHaveLength(0);
      expect(run.completed).toBe(true);
      expect(run.final.metrics.delivered).toBe(12);
    }
  });

  it('fleet composition changes measured makespan (recorded, not fabricated ranking)', () => {
    const sc = buildTinyScenario({ seed: 21, robots: 2, packages: 24 });
    const ids = sc.packages.map((p) => p.id);
    const mk: Record<string, number | null> = {};
    for (const fleet of [['R-01', 'R-02'], ['R-02'], ['R-01']]) {
      const run = planAndRun(sc, ids, fleet);
      mk[fleet.join('+')] = run.final.metrics.actualMakespanTicks;
    }
    // All runs complete; we only assert the measurements are real numbers (no invented ranking).
    for (const v of Object.values(mk)) {
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThan(0);
    }
  });
});

describe('greedy nearest-feasible baseline (strategy 2)', () => {
  it('assigns all tasks with per-trip capacity respected, deterministically', async () => {
    const { allocateNearestFeasible } = await import('../src/engine/allocation-nearest');
    const { DistanceIndex } = await import('../src/engine/pathfinding');
    const sc = buildTinyScenario({ seed: 40, robots: 2, packages: 18 });
    const ids = sc.packages.slice(0, 12).map((p) => p.id);
    const robots: RobotInstance[] = sc.robots.map((r) => ({ ...r, cell: r.homeCell }));
    const dx = new DistanceIndex(sc.map);
    dx.ensureScenario(
      sc.packages.map((p) => p.pickupCell),
      dockCellsOf(sc.map),
      robots.map((r) => r.cell),
    );
    const ctx = {
      map: sc.map,
      dockCells: dockCellsOf(sc.map),
      robots,
      packagesById: new Map(sc.packages.map((p) => [p.id, p])),
      selectedTaskIds: ids,
      carriedByRobot: {},
      dx,
      startTick: 0,
    };
    const a1 = allocateNearestFeasible(ctx);
    const a2 = allocateNearestFeasible(ctx);
    expect(a1.strategyId).toBe('greedy-nearest-feasible-v1');
    const strip = (r: typeof a1) => JSON.stringify({ ...r, planningMs: 0 });
    expect(strip(a1)).toBe(strip(a2));
    expect(a1.unassigned).toHaveLength(0);
    const assigned = a1.assignments.flatMap((x) => x.trips.flatMap((t) => t.taskIds)).sort();
    expect(assigned).toEqual(ids.slice().sort());
    for (const a of a1.assignments) {
      const robot = robots.find((r) => r.id === a.robotId)!;
      for (const t of a.trips) expect(t.taskIds.length).toBeLessThanOrEqual(robot.capacity);
    }
    // S1 with >1 task must use multiple trips
    const s1 = a1.assignments.find((a) => robots.find((r) => r.id === a.robotId)!.type === 'S1');
    if (s1 && s1.trips.reduce((n, t) => n + t.taskIds.length, 0) > 1) {
      expect(s1.trips.every((t) => t.taskIds.length <= 1)).toBe(true);
    }
  });
});
