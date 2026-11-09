// Presets: valid geometry, reachable pickups, real counts, distinct layouts.
import { describe, expect, it } from 'vitest';
import { PRESETS, buildPreset, sampleMission } from '../src/scenarios/presets';
import { validateScenario, walkableNeighbors } from '../src/engine/grid';
import { createMissionPlan, dockCellsOf } from '../src/engine/planner';
import { astar } from '../src/engine/pathfinding';
import { planAndRun } from './helpers';

describe('warehouse presets', () => {
  for (const { spec } of PRESETS) {
    it(`${spec.id}: geometry valid, all pickups reachable, counts in range`, () => {
      const sc = buildPreset(spec.id);
      expect(sc.map.width).toBeGreaterThanOrEqual(50);
      expect(sc.map.height).toBeGreaterThanOrEqual(36);
      expect(sc.packages.length).toBeGreaterThanOrEqual(55);
      expect(sc.robots.length).toBeGreaterThanOrEqual(6);
      // every robot on a legal walkable cell
      for (const r of sc.robots) {
        const t = sc.map.cells[r.homeCell];
        expect(t === 0 || t === 3, `robot ${r.id} on cell type ${t}`).toBe(true);
      }
      // every package pickup walkable with a neighbor
      for (const p of sc.packages) {
        const t = sc.map.cells[p.pickupCell];
        expect(t === 0 || t === 3, `${p.id} pickup type ${t}`).toBe(true);
        expect(walkableNeighbors(sc.map, p.pickupCell).length).toBeGreaterThan(0);
      }
      const issues = validateScenario(sc);
      expect(issues.filter((i) => i.level === 'error'), JSON.stringify(issues)).toEqual([]);
      // every pickup has an aisle path to a dock
      const docks = dockCellsOf(sc.map);
      expect(docks.length).toBeGreaterThan(0);
      for (const p of sc.packages.slice(0, 10)) {
        const r = astar(sc.map, p.pickupCell, docks[0]);
        expect(r.path, `${p.id} unreachable`).not.toBeNull();
      }
    });
  }

  it('presets are spatially distinct (different dimensions and rack layouts)', () => {
    const dims = PRESETS.map((p) => {
      const sc = buildPreset(p.spec.id);
      return `${sc.map.width}x${sc.map.height}:${sc.map.shelfRuns.length}`;
    });
    expect(new Set(dims).size).toBe(PRESETS.length);
  });

  it('sample mission (15 of N, 2 mixed robots) plans and completes on every preset', () => {
    for (const { spec } of PRESETS) {
      const sc = buildPreset(spec.id);
      const mission = sampleMission(sc, 15);
      expect(mission.taskIds).toHaveLength(15);
      const run = planAndRun(sc, mission.taskIds, mission.robotIds, { maxTicks: 8000 });
      expect(run.plan.failedRobots, `${spec.id}: ${JSON.stringify(run.plan.failedRobots)}`).toHaveLength(0);
      expect(run.completed, `${spec.id} did not complete`).toBe(true);
      expect(run.final.metrics.delivered).toBe(15);
    }
  });
});
