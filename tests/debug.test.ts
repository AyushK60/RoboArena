import { describe, expect, it } from 'vitest';
import { buildPreset } from '../src/scenarios/presets';
import { createMissionPlan, dockCellsOf } from '../src/engine/planner';

describe('debug single-task park', () => {
  it('1 task 1 robot parkTick', () => {
    const sc = buildPreset('ecommerce');
    const out = createMissionPlan({
      map: sc.map,
      dockCells: dockCellsOf(sc.map),
      packages: sc.packages,
      robots: sc.robots.slice(0, 1).map((r) => ({ ...r, cell: r.homeCell })),
      idleRobotCells: sc.robots.slice(1).map((r) => r.homeCell),
      selectedTaskIds: [sc.packages[0].id],
      carriedByRobot: {},
      startTick: 0,
    });
    console.log('failed:', JSON.stringify(out.plan.failedRobots));
    for (const rp of out.plan.plans) {
      console.log(rp.robotId, 'parkTick:', rp.parkTick, 'lastStep:', JSON.stringify(rp.steps[rp.steps.length - 1]), 'unload:', JSON.stringify(rp.unloadEvents));
    }
    expect(true).toBe(true);
  });
});
