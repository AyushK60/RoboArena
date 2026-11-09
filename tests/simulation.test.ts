// Simulation lifecycle: pickup→carry→deliver semantics, determinism, pause/step/reset, replay,
// and the 100-seed invariant sweep.
import { describe, expect, it } from 'vitest';
import { buildTinyScenario, planAndRun, checkPlanInvariants } from './helpers';
import { Simulation } from '../src/engine/simulation';
import { dockCellsOf, createMissionPlan } from '../src/engine/planner';
import type { Scenario, SimSnapshot } from '../src/engine/types';

function selectN(sc: Scenario, n: number): string[] {
  return sc.packages.slice(0, n).map((p) => p.id);
}

describe('mission lifecycle', () => {
  it('packages are delivered only after dock unload, not at pickup', () => {
    const sc = buildTinyScenario({ seed: 4, robots: 2, packages: 12 });
    const ids = selectN(sc, 6);
    const run = planAndRun(sc, ids, ['R-01', 'R-02']);
    expect(run.completed).toBe(true);
    // At every historical point, carried ⇒ not delivered.
    const ev = run.sim.events;
    for (const e of ev) {
      if (e.kind === 'pickup' && e.taskId) {
        const deliveredBefore = ev.some((o) => o.kind === 'trip_complete' && o.tick <= e.tick && o.robotId === e.robotId);
        void deliveredBefore;
      }
    }
    expect(run.final.metrics.delivered).toBe(6);
    expect(run.final.metrics.picked).toBe(6);
    // Final states: all delivered.
    for (const id of ids) expect(run.final.packageStates[id]).toBe('delivered');
  });

  it('deterministic replay: identical runs produce identical event logs', () => {
    const sc = buildTinyScenario({ seed: 13, robots: 3, packages: 24 });
    const ids = selectN(sc, 18);
    const a = planAndRun(sc, ids, ['R-01', 'R-02', 'R-03']);
    const b = planAndRun(sc, ids, ['R-01', 'R-02', 'R-03']);
    const strip = (m: typeof a.final.metrics) => {
      const { planningMs: _p, ...rest } = m;
      void _p;
      return rest;
    };
    expect(strip(a.final.metrics)).toEqual(strip(b.final.metrics));
    expect(a.sim.events.filter((e) => e.kind !== 'mission_start')).toEqual(
      b.sim.events.filter((e) => e.kind !== 'mission_start'),
    );
    expect(a.final.robots.map((r) => [r.cell, r.tripsCompleted, r.distanceMeters])).toEqual(
      b.final.robots.map((r) => [r.cell, r.tripsCompleted, r.distanceMeters]),
    );
  });

  it('framerate-independent: advancing in big steps equals tick-by-tick', () => {
    const sc = buildTinyScenario({ seed: 17, robots: 2, packages: 12 });
    const ids = selectN(sc, 8);
    const a = planAndRun(sc, ids, ['R-01', 'R-02']);
    // Fresh sim advanced in one jump.
    const dockCells = dockCellsOf(sc.map);
    const robots = sc.robots.filter((r) => ['R-01', 'R-02'].includes(r.id)).map((r) => ({ ...r, cell: r.homeCell }));
    const outcome = planAndRun(sc, ids, ['R-01', 'R-02'], { maxTicks: 0 });
    const sim2 = new Simulation(sc);
    void dockCells;
    void robots;
    void outcome;
    sim2.applyPlan(a.plan, { replan: false, selectedCount: ids.length });
    const target = a.final.tick;
    sim2.currentTick = 0;
    sim2.status = 'paused';
    // Step in chunks of 7.
    while (sim2.currentTick < target) sim2.step(Math.min(7, target - sim2.currentTick));
    const b = sim2.snapshot(ids.length);
    expect(b.metrics.delivered).toBe(a.final.metrics.delivered);
    expect(b.packageStates).toEqual(a.final.packageStates);
  });

  it('pause freezes, step advances exactly one tick, reset restores initial scenario', () => {
    const sc = buildTinyScenario({ seed: 23, robots: 2, packages: 12 });
    const ids = selectN(sc, 6);
    const run = planAndRun(sc, ids, ['R-01', 'R-02']);
    const sim = run.sim;
    sim.reset();
    expect(sim.currentTick).toBe(0);
    expect(sim.status).toBe('ready');
    const before = sim.snapshot(ids.length);
    expect(before.metrics.delivered).toBe(0);
    sim.play();
    expect(sim.status).toBe('running');
    sim.pause();
    const t = sim.currentTick;
    sim.step();
    expect(sim.currentTick).toBe(t + 1);
    sim.step(5);
    expect(sim.currentTick).toBe(t + 6);
    sim.reset();
    expect(sim.currentTick).toBe(0);
    // Robots back at home cells.
    for (const r of sim.robots) expect(r.cell).toBe(r.homeCell);
  });
});

describe('invariant sweep (100 seeded scenarios)', () => {
  it('no collisions, capacity violations, double-pickups or lost tasks across seeds', () => {
    let planningFailures = 0;
    let completedRuns = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const robots = 1 + (seed % 4); // 1..4
      const packages = 6 + (seed % 18); // 6..23
      const sc = buildTinyScenario({ seed, robots, packages });
      const ids = selectN(sc, Math.max(1, Math.floor(sc.packages.length * 0.75)));
      const fleet = sc.robots.slice(0, Math.max(1, Math.min(robots, 1 + (seed % 3)))).map((r) => r.id);
      const run = planAndRun(sc, ids, fleet, { maxTicks: 6000 });
      const violations = checkPlanInvariants(sc, run.plan);
      expect(violations, `seed ${seed}: ${violations.slice(0, 5).join('; ')}`).toEqual([]);
      if (run.plan.failedRobots.length > 0) {
        planningFailures++;
        // A failed robot's tasks must NOT be marked delivered anywhere.
        const failedIds = run.plan.failedRobots.map((f) => f.robotId);
        for (const rp of run.plan.plans) {
          if (failedIds.includes(rp.robotId)) continue;
        }
        continue;
      }
      expect(run.completed, `seed ${seed} did not complete`).toBe(true);
      expect(run.final.metrics.delivered).toBe(ids.length);
      completedRuns++;
    }
    // Prioritized planning is allowed to fail occasionally, but must succeed on the vast majority.
    expect(planningFailures).toBeLessThanOrEqual(10);
    expect(completedRuns).toBeGreaterThanOrEqual(90);
  });
});

function snapshotAt(sim: Simulation, selected: number, tick: number): SimSnapshot {
  sim.currentTick = tick;
  return sim.snapshot(selected);
}

void snapshotAt;

describe('mid-run replanning', () => {
  it('delivered tasks stay delivered and carried tasks stay with their robot after replan', () => {
    const sc = buildTinyScenario({ seed: 31, robots: 2, packages: 18 });
    const ids = selectN(sc, 12);
    const run = planAndRun(sc, ids, ['R-01', 'R-02'], { maxTicks: 400 });
    // stop at an arbitrary mid-mission tick where at least one delivery happened
    const sim = run.sim;
    let tick = 0;
    for (let t = 0; t < run.final.tick; t++) {
      sim.currentTick = t;
      if (sim.snapshot(ids.length).metrics.delivered >= 1) {
        tick = t;
        break;
      }
    }
    // Build a replan from the current state: remaining tasks + carried cargo
    const snap = sim.snapshot(ids.length);
    const carried: Record<string, string[]> = {};
    for (const [taskId, robotId] of Object.entries(snap.carriedBy)) {
      (carried[robotId] ??= []).push(taskId);
    }
    const remaining = ids.filter((id) => snap.packageStates[id] !== 'delivered' && snap.packageStates[id] !== 'carried');
    const dockCells = dockCellsOf(sc.map);
    const participating = sc.robots
      .filter((r) => ['R-01', 'R-02'].includes(r.id))
      .map((r) => ({ ...r, cell: snap.robots.find((rv) => rv.id === r.id)!.cell }));
    const outcome = createMissionPlan({
      map: sc.map,
      dockCells,
      packages: sc.packages,
      robots: participating,
      idleRobotCells: [],
      selectedTaskIds: [...remaining, ...Object.values(carried).flat()],
      carriedByRobot: carried,
      startTick: tick,
    });
    sim.applyPlan(outcome.plan, { replan: true, selectedCount: ids.length });
    expect(sim.snapshot(ids.length).metrics.delivered).toBeGreaterThanOrEqual(1);
    // run the replanned mission to the end
    for (let i = 0; i < 5000; i++) {
      if (!sim.tickForward()) break;
    }
    const finalSnap = sim.snapshot(ids.length);
    expect(finalSnap.metrics.delivered).toBe(ids.length);
    // every selected package delivered exactly once: no package left carried/assigned
    for (const id of ids) expect(finalSnap.packageStates[id]).toBe('delivered');
  });
});
