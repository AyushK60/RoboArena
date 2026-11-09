// Deterministic simulation kernel. The mission plan is a precomputed timed schedule; the tick
// cursor simply advances through it. All state (positions, cargo, metrics) is DERIVED from
// (plan, tick) — pausing, stepping and replaying cannot desynchronize anything.
import { CELL_METERS, TICK_SECONDS } from './constants';
import { xOf } from './grid';
import type {
  Metrics,
  PackageData,
  PackageState,
  PlanResult,
  RobotInstance,
  RobotSimState,
  RobotView,
  ScheduledEvent,
  SimSnapshot,
  Scenario,
} from './types';

export interface EnginePosition {
  robotId: string;
  cell: number;
  prevCell: number;
  moveFraction: number; // 0..1 between prevCell and cell (for rendering)
  dir: 0 | 1 | 2 | 3;
}

export class Simulation {
  scenario!: Scenario;
  robots: RobotInstance[] = [];
  plan: PlanResult | null = null;
  events: ScheduledEvent[] = [];
  carriedByRobot: Record<string, string[]> = {};
  currentTick = 0;
  status: 'idle' | 'ready' | 'running' | 'paused' | 'finished' = 'idle';
  missionCompleteTick: number | null = null;
  /** Base package states (before this run's events) — reset/replay target. */
  basePackageStates: Record<string, PackageState> = {};
  /** Deliveries completed before the last (re)plan — preserved across replans. */
  private deliveredRecords: { tick: number; taskIds: string[]; robotId: string }[] = [];

  constructor(scenario: Scenario) {
    this.loadScenario(scenario);
  }

  loadScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.robots = scenario.robots.map((r) => ({ ...r, cell: r.homeCell }));
    this.basePackageStates = Object.fromEntries(scenario.packages.map((p) => [p.id, p.state]));
    this.plan = null;
    this.events = [];
    this.carriedByRobot = {};
    this.currentTick = 0;
    this.status = 'idle';
    this.missionCompleteTick = null;
    this.deliveredRecords = [];
  }

  /** Commit a freshly planned mission (or a mid-run replan; history events are preserved). */
  applyPlan(plan: PlanResult, opts: { replan: boolean; selectedCount: number }): void {
    const startTick = this.currentTick;
    if (opts.replan && this.plan) {
      // Preserve deliveries that already happened (their unload events leave the plan).
      for (const rp of this.plan.plans) {
        for (const ue of rp.unloadEvents) {
          if (ue.tick <= startTick) this.deliveredRecords.push({ tick: ue.tick, taskIds: ue.taskIds, robotId: rp.robotId });
        }
      }
    } else {
      this.deliveredRecords = [];
    }
    this.plan = plan;
    const future: ScheduledEvent[] = [];
    if (!opts.replan) {
      this.carriedByRobot = {};
      future.push({ tick: startTick, kind: 'mission_start', message: 'Mission started.' });
    } else {
      future.push({ tick: startTick, kind: 'replan', message: 'Plan recomputed from current positions.' });
    }
    for (const f of plan.failedRobots) {
      future.push({
        tick: startTick,
        kind: 'planning_failed',
        robotId: f.robotId,
        message: `${f.robotId}: ${f.reason}`,
      });
    }
    // Rebuild carried state at startTick from history events.
    this.carriedByRobot = {};
    for (const e of this.events) {
      if (e.tick > startTick) continue;
      if (e.kind === 'pickup' && e.robotId && e.taskId) {
        (this.carriedByRobot[e.robotId] ??= []).push(e.taskId);
      } else if (e.kind === 'trip_complete' && e.robotId) {
        this.carriedByRobot[e.robotId] = [];
      }
    }
    let lastUnload = startTick;
    let plannedTaskCount = 0;
    for (const rp of plan.plans) {
      for (const pe of rp.pickupEvents) {
        if (pe.tick > startTick) {
          future.push({ tick: pe.tick, kind: 'pickup', robotId: rp.robotId, taskId: pe.taskId, message: `${rp.robotId} picked up ${pe.taskId}.` });
        }
      }
      for (const ue of rp.unloadEvents) {
        if (ue.tick > startTick) {
          future.push({
            tick: ue.tick,
            kind: 'trip_complete',
            robotId: rp.robotId,
            message: `${rp.robotId} unloaded ${ue.taskIds.length} package(s) at the dock (trip ${ue.tripIndex + 1} complete).`,
          });
        }
        if (ue.tick > lastUnload) lastUnload = ue.tick;
        plannedTaskCount += ue.taskIds.length;
      }
    }
    if (plannedTaskCount > 0) {
      // The visible mission ends when the last robot is back at its bay (deliveries complete
      // earlier for robots that finish first); makespan is still measured at the last delivery.
      let lastPark = lastUnload;
      for (const rp of plan.plans) {
        if (rp.parkTick !== null && rp.parkTick > lastPark) lastPark = rp.parkTick;
      }
      future.push({
        tick: lastPark,
        kind: 'mission_complete',
        message:
          plan.failedRobots.length > 0
            ? `Mission finished with unresolved robots: ${plan.failedRobots.map((f) => f.robotId).join(', ')}.`
            : 'Mission complete — all selected packages delivered and robots back in their bays.',
      });
      this.missionCompleteTick = lastPark;
    } else {
      // Nothing to do: the mission is trivially complete at its start tick.
      this.missionCompleteTick = startTick;
    }
    future.sort((a, b) => a.tick - b.tick);
    if (opts.replan) {
      this.events = this.events.filter((e) => e.tick <= startTick).concat(future);
    } else {
      this.events = future;
    }
    this.events.sort((a, b) => a.tick - b.tick);
    this.status = 'ready';
  }

  play(): void {
    if (!this.plan) return;
    if (this.status === 'finished') return;
    this.status = 'running';
  }

  pause(): void {
    if (this.status === 'running') this.status = 'paused';
  }

  step(ticks = 1): void {
    if (!this.plan) return;
    if (this.status === 'finished') return;
    this.pause();
    for (let i = 0; i < ticks; i++) {
      if (this.missionCompleteTick !== null && this.currentTick >= this.missionCompleteTick) break;
      this.currentTick++;
    }
    this.refreshFinish();
  }

  reset(): void {
    this.currentTick = 0;
    this.robots = this.scenario.robots.map((r) => ({ ...r, cell: r.homeCell }));
    this.status = this.plan ? 'ready' : 'idle';
  }

  /** Advance one tick; returns false when the mission is complete. */
  tickForward(): boolean {
    if (!this.plan) return false;
    if (this.missionCompleteTick !== null && this.currentTick >= this.missionCompleteTick) {
      this.refreshFinish();
      return false;
    }
    this.currentTick++;
    this.refreshFinish();
    return this.status !== 'finished';
  }

  private refreshFinish(): void {
    if (this.missionCompleteTick !== null && this.currentTick >= this.missionCompleteTick) {
      this.status = 'finished';
    }
  }

  /** Positions for rendering at a continuous tick (may be fractional). */
  positionsAt(tickFloat: number): EnginePosition[] {
    const out: EnginePosition[] = [];
    for (const robot of this.robots) {
      let rp = this.plan?.plans.find((p) => p.robotId === robot.id);
      if (!rp) {
        const idle = this.plan?.idlePlans.find((p) => p.robotId === `idle@${robot.homeCell}`);
        if (idle && idle.steps.length > 0) {
          rp = { robotId: robot.id, steps: idle.steps, finishTick: 0, parkTick: null, pickupEvents: [], unloadEvents: [], dwellSteps: [] };
        }
      }
      if (!rp || rp.steps.length === 0) {
        out.push({ robotId: robot.id, cell: robot.cell, prevCell: robot.cell, moveFraction: 0, dir: 1 });
        continue;
      }
      const steps = rp.steps;
      let i = 0;
      while (i + 1 < steps.length && steps[i + 1].arriveTick <= tickFloat) i++;
      const cur = steps[i];
      const next = steps[i + 1];
      let cell = cur.cell;
      let prevCell = cur.cell;
      let fraction = 0;
      let dir: 0 | 1 | 2 | 3 = 1;
      if (next && tickFloat > cur.departTick) {
        const span = next.arriveTick - cur.departTick; // MOVE_TICKS
        fraction = Math.max(0, Math.min(1, (tickFloat - cur.departTick) / span));
        prevCell = cur.cell;
        cell = next.cell;
        dir = dirBetween(this.scenario.map.width, cur.cell, next.cell) as 0 | 1 | 2 | 3;
      } else if (i > 0) {
        prevCell = steps[i - 1].cell;
        dir = dirBetween(this.scenario.map.width, prevCell, cur.cell) as 0 | 1 | 2 | 3;
      } else {
        dir = 1;
      }
      // Robots that already finished stay at their final cell.
      out.push({ robotId: robot.id, cell, prevCell, moveFraction: fraction, dir });
    }
    return out;
  }

  robotStateAt(robotId: string, tick: number): RobotSimState {
    const rp = this.plan?.plans.find((p) => p.robotId === robotId);
    if (!rp) return 'idle';
    const missionDone = this.missionCompleteTick !== null && tick >= this.missionCompleteTick;
    if (missionDone) {
      if (rp.parkTick !== null) return tick >= rp.parkTick ? 'parked' : 'parking';
      return 'done';
    }
    const steps = rp.steps;
    let idx = 0;
    while (idx + 1 < steps.length && steps[idx + 1].arriveTick <= tick) idx++;
    const s = steps[idx];
    // In transit when the current step has departed (arrival tick of the next cell == depart+1);
    // equality counts as departing so robots never flicker 'idle' between cells.
    const inTransit = idx + 1 < steps.length && tick >= s.departTick;
    if (!inTransit) {
      const dwell = this.plan
        ? rp.dwellSteps.find((d) => d.stepIndex === idx)
        : undefined;
      if (dwell) return dwell.kind === 'pickup' ? 'pickingUp' : 'unloading';
      if (s.wait) return 'waiting';
      if (tick >= rp.finishTick && rp.unloadEvents.length > 0) return 'done';
      return 'idle';
    }
    const cargo = this.cargoOf(robotId, tick);
    return cargo.length > 0 ? 'toDock' : 'moving';
  }

  cargoOf(robotId: string, tick: number): string[] {
    const cargo: string[] = [];
    for (const e of this.events) {
      if (e.tick > tick) break;
      if (e.robotId !== robotId) continue;
      if (e.kind === 'pickup' && e.taskId) cargo.push(e.taskId);
      else if (e.kind === 'trip_complete') cargo.length = 0;
    }
    return cargo;
  }

  packageStatesAt(tick: number): Record<string, PackageState> {
    const out: Record<string, PackageState> = { ...this.basePackageStates };
    if (this.plan) {
      for (const [id, st] of Object.entries(this.plan.taskStates)) {
        if (out[id] === 'unassigned' || out[id] === 'unreachable') out[id] = st;
      }
    }
    for (const e of this.events) {
      if (e.tick > tick) break;
      if (e.kind === 'pickup' && e.taskId) out[e.taskId] = 'carried';
    }
    for (const rec of this.deliveredRecords) {
      if (rec.tick <= tick) for (const id of rec.taskIds) out[id] = 'delivered';
    }
    if (this.plan) {
      for (const rp of this.plan.plans) {
        for (const ue of rp.unloadEvents) {
          if (ue.tick <= tick) for (const id of ue.taskIds) out[id] = 'delivered';
        }
      }
    }
    return out;
  }

  carriedAt(tick: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.events) {
      if (e.tick > tick) break;
      if (e.kind === 'pickup' && e.taskId && e.robotId) out[e.taskId] = e.robotId;
    }
    for (const rec of this.deliveredRecords) {
      if (rec.tick <= tick) for (const id of rec.taskIds) delete out[id];
    }
    if (this.plan) {
      for (const rp of this.plan.plans) {
        for (const ue of rp.unloadEvents) {
          if (ue.tick <= tick) for (const id of ue.taskIds) delete out[id];
        }
      }
    }
    return out;
  }

  metricsAt(tick: number, selectedCount: number): Metrics {
    const perRobot: Metrics['perRobot'] = {};
    let picked = 0;
    let delivered = 0;
    let trips = 0;
    let actualMakespan: number | null = null;
    for (const e of this.events) {
      if (e.tick > tick) break;
      if (e.kind === 'pickup') picked++;
      if (e.kind === 'trip_complete') trips++;
      if (e.kind === 'mission_complete') actualMakespan = e.tick;
    }
    for (const rec of this.deliveredRecords) {
      if (rec.tick <= tick) {
        delivered += rec.taskIds.length;
        if (rec.tick > (actualMakespan ?? -1)) actualMakespan = rec.tick;
      }
    }
    if (this.plan) {
      for (const rp of this.plan.plans) {
        for (const ue of rp.unloadEvents) {
          if (ue.tick <= tick) {
            delivered += ue.taskIds.length;
            if (ue.tick > (actualMakespan ?? -1)) actualMakespan = ue.tick;
          }
        }
      }
    }
    let distanceMeters = 0;
    let waitTicks = 0;
    for (const rp of this.plan?.plans ?? []) {
      let moves = 0;
      let waits = 0;
      for (let i = 1; i < rp.steps.length; i++) {
        if (rp.steps[i].arriveTick <= tick) moves++;
      }
      for (const s of rp.steps) {
        if (s.wait && s.departTick <= tick) waits += s.departTick - s.arriveTick;
        else if (s.wait && s.arriveTick <= tick) waits += tick - s.arriveTick;
      }
      distanceMeters += moves * CELL_METERS;
      waitTicks += waits;
    }
    for (const robot of this.robots) {
      const rp = this.plan?.plans.find((p) => p.robotId === robot.id);
      let robotDelivered = 0;
      let robotTrips = 0;
      let robotDistance = 0;
      let robotWaits = 0;
      for (const rec of this.deliveredRecords) {
        if (rec.robotId === robot.id && rec.tick <= tick) {
          robotDelivered += rec.taskIds.length;
          robotTrips++;
        }
      }
      if (rp) {
        for (const ue of rp.unloadEvents) {
          if (ue.tick <= tick) {
            robotDelivered += ue.taskIds.length;
            robotTrips++;
          }
        }
        let moves = 0;
        for (let i = 1; i < rp.steps.length; i++) if (rp.steps[i].arriveTick <= tick) moves++;
        robotDistance = moves * CELL_METERS;
        for (const s of rp.steps) {
          if (s.wait && s.departTick <= tick) robotWaits += s.departTick - s.arriveTick;
          else if (s.wait && s.arriveTick <= tick) robotWaits += tick - s.arriveTick;
        }
      }
      perRobot[robot.id] = {
        delivered: robotDelivered,
        trips: robotTrips,
        distanceMeters: robotDistance,
        waitTicks: robotWaits,
        state: this.robotStateAt(robot.id, tick),
        cargoCount: this.cargoOf(robot.id, tick).length,
      };
    }
    let lastParked: number | null = null;
    for (const rp of this.plan?.plans ?? []) {
      const pt = rp.parkTick;
      if (pt !== null && pt <= tick && pt > (lastParked ?? -1)) lastParked = pt;
    }
    return {
      selected: selectedCount,
      picked,
      delivered,
      trips,
      distanceMeters,
      waitTicks,
      actualMakespanTicks: actualMakespan,
      lastParkedTick: lastParked,
      plannedMakespanTicks: this.plan?.estimatedMakespanTicks ?? null,
      conflictsAvoided: this.plan?.conflictsAvoided ?? 0,
      planningMs: this.plan?.planningMs ?? 0,
      perRobot,
    };
  }

  snapshot(selectedCount: number): SimSnapshot {
    const tick = this.currentTick;
    const positions = this.positionsAt(tick);
    const posById = new Map(positions.map((p) => [p.robotId, p]));
    const robots: RobotView[] = this.robots.map((r) => {
      const p = posById.get(r.id)!;
      const cargo = this.cargoOf(r.id, tick);
      const m = this.metricsAt(tick, selectedCount).perRobot[r.id];
      return {
        id: r.id,
        type: r.type,
        capacity: r.capacity,
        cell: p.cell,
        prevCell: p.prevCell,
        moveFraction: p.moveFraction,
        dir: p.dir,
        state: this.robotStateAt(r.id, tick),
        cargo,
        tripsCompleted: m.trips,
        pickupsDone: m.delivered + cargo.length,
        deliveriesDone: m.delivered,
        distanceMeters: m.distanceMeters,
        waitTicks: m.waitTicks,
        finished: this.robotStateAt(r.id, tick) === 'done',
        dwellTotal: 0,
      };
    });
    // Dwell progress for the progress ring.
    for (const rv of robots) {
      const rp = this.plan?.plans.find((p) => p.robotId === rv.id);
      if (!rp) continue;
      const idx = rp.dwellSteps.find((d) => {
        const s = rp.steps[d.stepIndex];
        return s.arriveTick <= tick && tick < s.departTick;
      });
      if (idx) {
        const s = rp.steps[idx.stepIndex];
        rv.dwellTotal = Math.min(1, (tick - s.arriveTick) / Math.max(1, s.departTick - s.arriveTick));
      }
    }
    return {
      tick,
      timeSeconds: tick * TICK_SECONDS,
      status: this.status,
      robots,
      packageStates: this.packageStatesAt(tick),
      carriedBy: this.carriedAt(tick),
      events: this.events.slice(-200),
      metrics: this.metricsAt(tick, selectedCount),
      hasPlan: !!this.plan,
    };
  }
}

function dirBetween(width: number, a: number, b: number): 0 | 1 | 2 | 3 {
  const ax = a % width;
  const ay = Math.floor(a / width);
  const bx = b % width;
  const by = Math.floor(b / width);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 1) return 1;
  if (dx === -1) return 3;
  if (dy === 1) return 2;
  return 0;
}
