// Shared deterministic fixtures for engine tests.
import { buildTinyScenario, type TinyScenarioOptions } from '../src/scenarios/tiny';
import { createMissionPlan, dockCellsOf } from '../src/engine/planner';
import { Simulation } from '../src/engine/simulation';
import type { PlanResult, Scenario, SimSnapshot } from '../src/engine/types';

export { buildTinyScenario };

export interface RunOutcome {
  scenario: Scenario;
  plan: PlanResult;
  sim: Simulation;
  final: SimSnapshot;
  completed: boolean;
}

/** Select tasks, plan with the given robot subset, and run the mission to completion. */
export function planAndRun(
  scenario: Scenario,
  selectedTaskIds: string[],
  robotIds: string[],
  opts: { startTick?: number; maxTicks?: number; preselectedState?: boolean } = {},
): RunOutcome {
  const maxTicks = opts.maxTicks ?? 5000;
  const dockCells = dockCellsOf(scenario.map);
  const participating = scenario.robots.filter((r) => robotIds.includes(r.id));
  const idleCells = scenario.robots.filter((r) => !robotIds.includes(r.id)).map((r) => r.homeCell);
  const robots: PlanRobot[] = participating.map((r) => ({ ...r, cell: r.homeCell }));
  const outcome = createMissionPlan({
    map: scenario.map,
    dockCells,
    packages: scenario.packages,
    robots,
    idleRobotCells: idleCells,
    selectedTaskIds,
    carriedByRobot: {},
    startTick: opts.startTick ?? 0,
  });
  const sim = new Simulation(scenario);
  sim.applyPlan(outcome.plan, { replan: false, selectedCount: selectedTaskIds.length });
  let completed = false;
  for (let i = 0; i < maxTicks; i++) {
    if (!sim.tickForward()) {
      completed = true;
      break;
    }
  }
  return { scenario, plan: outcome.plan, sim, final: sim.snapshot(selectedTaskIds.length), completed };
}

type PlanRobot = Scenario['robots'][number] & { cell: number };

/**
 * Per-tick invariants from spec 02 §Correctness invariants, checked over the whole plan.
 * Returns a list of violations (empty = pass).
 */
export function checkPlanInvariants(scenario: Scenario, plan: PlanResult): string[] {
  const bad: string[] = [];
  const horizon = Math.max(
    1,
    ...plan.plans.map((p) => (p.steps.length ? p.steps[p.steps.length - 1].departTick : 0)),
  );
  // 1. No two robots share a cell at the same tick (including parked robots & final docks).
  for (let t = 0; t <= horizon; t++) {
    const cellOwner = new Map<number, string>();
    for (const rp of plan.plans) {
      const step = stepAt(rp, t);
      if (!step) continue;
      const owner = cellOwner.get(step.cell);
      if (owner && owner !== rp.robotId) {
        bad.push(`tick ${t}: ${owner} and ${rp.robotId} share cell ${step.cell}`);
      }
      cellOwner.set(step.cell, rp.robotId);
    }
  }
  // 2. No head-on edge swap.
  for (let t = 0; t <= horizon; t++) {
    const moves = new Map<string, string>(); // "a>b" -> robotId
    for (const rp of plan.plans) {
      const s0 = stepAt(rp, t);
      const s1 = stepAt(rp, t + 1);
      if (!s0 || !s1 || s0.cell === s1.cell) continue;
      moves.set(`${s0.cell}>${s1.cell}`, rp.robotId);
    }
    for (const [k, id] of moves) {
      const [a, b] = k.split('>');
      const reverse = `${b}>${a}`;
      const other = moves.get(reverse);
      if (other && other !== id) bad.push(`tick ${t}: head-on swap ${a}<->${b} between ${id} and ${other}`);
    }
  }
  // 3. Every robot stays on legal walkable cells.
  for (const rp of plan.plans) {
    for (const s of rp.steps) {
      const t = s.cell;
      if (t < 0 || t >= scenario.map.cells.length) bad.push(`${rp.robotId}: out-of-map cell ${s.cell}`);
      else {
        const ct = scenario.map.cells[s.cell];
        if (ct !== 0 && ct !== 3) bad.push(`${rp.robotId}: occupies blocked cell ${s.cell} (type ${ct}) at tick ${s.arriveTick}`);
      }
    }
  }
  // 4. Cargo capacity at every tick + one-carrier uniqueness + delivered finality (from events).
  const capacity = new Map(scenario.robots.map((r) => [r.id, r.capacity]));
  const carrier = new Map<string, string>(); // taskId -> robotId
  const deliveredSet = new Set<string>();
  const events = plan.plans
    .flatMap((rp) => [
      ...rp.pickupEvents.map((e) => ({ tick: e.tick, kind: 'pickup' as const, robot: rp.robotId, taskId: e.taskId })),
      ...rp.unloadEvents.flatMap((e) =>
        e.taskIds.map((id) => ({ tick: e.tick, kind: 'unload' as const, robot: rp.robotId, taskId: id })),
      ),
    ])
    .sort((a, b) => a.tick - b.tick);
  const cargo = new Map<string, string[]>();
  for (let t = 0; t <= horizon; t++) {
    for (const e of events) {
      if (e.tick !== t) continue;
      if (e.kind === 'pickup') {
        if (deliveredSet.has(e.taskId)) bad.push(`tick ${t}: ${e.taskId} picked after delivery`);
        if (carrier.has(e.taskId)) bad.push(`tick ${t}: ${e.taskId} picked by ${e.robot} while carried by ${carrier.get(e.taskId)}`);
        carrier.set(e.taskId, e.robot);
        let c = cargo.get(e.robot);
        if (!c) {
          c = [];
          cargo.set(e.robot, c);
        }
        c.push(e.taskId);
      } else {
        if (deliveredSet.has(e.taskId)) bad.push(`tick ${t}: ${e.taskId} delivered twice`);
        if (carrier.get(e.taskId) !== e.robot) bad.push(`tick ${t}: ${e.taskId} unloaded by ${e.robot} but carried by ${carrier.get(e.taskId)}`);
        deliveredSet.add(e.taskId);
        const c = cargo.get(e.robot)!;
        const ix = c.indexOf(e.taskId);
        if (ix >= 0) c.splice(ix, 1);
      }
    }
    for (const [rid, c] of cargo) {
      if (c.length > capacity.get(rid)!) bad.push(`tick ${t}: ${rid} carries ${c.length} > capacity ${capacity.get(rid)}`);
    }
  }
  return bad;
}

function stepAt(rp: PlanResult['plans'][number], t: number): { cell: number } | null {
  if (rp.steps.length === 0) return null;
  if (t < rp.steps[0].arriveTick) return null;
  let i = 0;
  while (i + 1 < rp.steps.length && rp.steps[i + 1].arriveTick <= t) i++;
  const s = rp.steps[i];
  return { cell: s.cell };
}

export function tinyOpts(overrides: Partial<TinyScenarioOptions> = {}): TinyScenarioOptions {
  return { seed: 7, robots: 2, packages: 12, ...overrides };
}
