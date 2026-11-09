// Application store: owns the scenario, simulation, mission plan, editor state and playback.
// React subscribes via useSyncExternalStore on a version counter; the canvas reads state
// directly each frame (no React re-render per frame).
import { buildPreset, presetSummaries, sampleMission, PRESETS } from '../scenarios/presets';
import { createMissionPlan, dockCellsOf, type MissionPlanOutcome } from '../engine/planner';
import { Simulation } from '../engine/simulation';
import { validateScenario, type ValidationIssue } from '../engine/grid';
import { SCHEMA_VERSION, TICK_SECONDS, MAX_FLEET } from '../engine/constants';
import { missionFingerprint } from '../engine/mission';
import {
  CellType,
} from '../engine/types';
import type {
  PackageData,
  PlanResult,
  RobotInstance,
  Scenario,
  SimSnapshot,
} from '../engine/types';

export type AppMode = 'overview' | 'design' | 'plan' | 'simulate' | 'analyze' | 'compare';
export type EditTool = 'select' | 'move' | 'rack' | 'erase' | 'package' | 'home' | 'pan';

export interface ComparisonRow {
  key: 'insertion' | 'nearest';
  name: string;
  planningMs: number;
  plannedMakespan: number | null;
  actualMakespan: number | null;
  lastParked: number | null;
  distanceMeters: number;
  trips: number;
  delivered: number;
  selected: number;
  conflicts: number;
  failed: number;
  perRobot: { id: string; delivered: number; trips: number }[];
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface PlanSummary {
  strategyName: string;
  planningMs: number;
  estimatedMakespanTicks: number;
  conflictsAvoided: number;
  assignmentNotes: Record<string, string>;
  unassigned: { taskId: string; reason: string }[];
  failedRobots: { robotId: string; reason: string }[];
  tripsByRobot: Record<string, { taskIds: string[]; dockCell: number }[]>;
}

const CUSTOM_KEY = 'roboarena:custom-scenarios:v1';

function scenarioToJson(sc: Scenario): unknown {
  return {
    ...sc,
    schemaVersion: SCHEMA_VERSION,
    map: { ...sc.map, cells: Array.from(sc.map.cells) },
  };
}

function scenarioFromJson(raw: unknown): Scenario {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not an object');
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version ${String(o.schemaVersion)}`);
  const map = o.map as Record<string, unknown>;
  const width = map.width as number;
  const height = map.height as number;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 10 || height < 8 || width * height > 100000) {
    throw new Error('Invalid map dimensions');
  }
  const cellsArr = map.cells as unknown[];
  if (!Array.isArray(cellsArr) || cellsArr.length !== width * height) throw new Error('Invalid cell data');
  const cells = new Uint8Array(cellsArr.map((v) => (typeof v === 'number' && v >= 0 && v <= 4 ? v : 0)));
  const packages = (o.packages as Record<string, unknown>[]).map((p, i) => ({
    id: String(p.id ?? `P-${i + 1}`),
    shape: (p.shape as PackageData['shape']) ?? 'carton',
    cell: p.cell as number,
    pickupCell: p.pickupCell as number,
    shelfLabel: String(p.shelfLabel ?? ''),
    aisleLabel: String(p.aisleLabel ?? ''),
    state: 'unassigned' as const,
    seed: (p.seed as number) ?? 0,
  }));
  const robots = (o.robots as Record<string, unknown>[]).map((r, i) => ({
    id: String(r.id ?? `R-${i + 1}`),
    type: r.type === 'H10' ? ('H10' as const) : ('S1' as const),
    capacity: r.type === 'H10' ? 10 : 1,
    homeCell: r.homeCell as number,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(o.id ?? 'custom'),
    map: {
      id: String(map.id ?? 'custom'),
      name: String(map.name ?? 'Custom Warehouse'),
      subtitle: String(map.subtitle ?? 'Imported scenario'),
      width,
      height,
      revision: 1,
      cells,
      zones: (map.zones as Scenario['map']['zones']) ?? [],
      shelfRuns: (map.shelfRuns as Scenario['map']['shelfRuns']) ?? [],
      trucks: (map.trucks as Scenario['map']['trucks']) ?? [],
      chargeCells: (map.chargeCells as number[]) ?? [],
    },
    packages,
    robots,
  };
}

export class AppStore {
  version = 0;
  private listeners = new Set<() => void>();
  private nextToastId = 1;
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  scenario: Scenario = buildPreset('ecommerce');
  sim = new Simulation(this.scenario);
  mode: AppMode = 'overview';
  tool: EditTool = 'select';
  selectedTaskIds: Set<string> = new Set();
  selectedRobotIds: Set<string> = new Set();
  focusRobotId: string | null = null;
  planOutcome: MissionPlanOutcome | null = null;
  planSummary: PlanSummary | null = null;
  planFingerprint: string | null = null;
  hoveredPackageId: string | null = null;
  playing = false;
  speed = 1;
  tickFloat = 0;
  toasts: Toast[] = [];
  validation: ValidationIssue[] = [];
  learnOpen = false;
  guidedStep = -1; // -1 inactive; index into GUIDED_STAGES
  guidedPlanPending = false;
  movingPackageId: string | null = null;
  homeToolRobotId: string | null = null;
  strategy: 'insertion' | 'nearest' = 'insertion';
  comparison: {
    ranAt: string;
    scenarioId: string;
    tasks: number;
    fleet: number;
    rows: {
      key: 'insertion' | 'nearest';
      name: string;
      planningMs: number;
      plannedMakespan: number | null;
      actualMakespan: number | null;
      lastParked: number | null;
      distanceMeters: number;
      trips: number;
      delivered: number;
      selected: number;
      conflicts: number;
      failed: number;
      perRobot: { id: string; delivered: number; trips: number }[];
    }[];
  } | null = null;
  private guidedTimer = 0;

  /** Guided stages advance on ACTUAL state - a stage that never occurs is skipped honestly. */
  startGuidedDemo(): void {
    this.mode = 'simulate';
    this.selectSampleMission(15);
    this.guidedStep = 0;
    this.planMission();
    this.play();
    this.toast('info', 'Guided mission started - follow the steps in the guide panel.');
    this.stopGuidedWatcher();
    this.guidedTimer = window.setInterval(() => this.guidedCheck(), 350);
    this.notify();
  }

  exitGuidedDemo(): void {
    this.guidedStep = -1;
    this.stopGuidedWatcher();
    this.pause();
    this.notify();
  }

  guidedNext(): void {
    if (this.guidedStep < 0) return;
    this.guidedStep = Math.min(this.guidedStep + 1, GUIDED_STAGES.length - 1);
    this.notify();
  }

  guidedSkipStage(): void {
    this.guidedNext();
  }

  private stopGuidedWatcher(): void {
    if (this.guidedTimer) {
      window.clearInterval(this.guidedTimer);
      this.guidedTimer = 0;
    }
  }

  private guidedCheck(): void {
    if (this.guidedStep < 0 || !this.planOutcome) return;
    const stage = GUIDED_STAGES[this.guidedStep];
    if (!stage || !stage.auto) return;
    const snap = this.sim.snapshot(this.selectedTaskIds.size);
    let advance = false;
    switch (stage.id) {
      case 'assignment':
        advance = this.sim.currentTick >= 0 && !!this.planOutcome; // already satisfied → user advances manually
        break;
      case 'movement':
        advance = snap.metrics.picked > 0 || snap.tick > 5;
        break;
      case 'pickup':
        advance = snap.metrics.picked >= 1;
        break;
      case 'delivery':
        advance = snap.metrics.delivered >= 1;
        break;
      case 'avoidance':
        // only meaningful when the planner actually had to resolve a conflict
        advance = false; // stays until user advances; explanation is conditional below
        break;
      case 'return':
        advance = snap.status === 'finished';
        break;
      case 'summary':
        advance = snap.status === 'finished' && snap.metrics.lastParkedTick !== null;
        break;
      default:
        advance = false;
    }
    if (advance && stage.id !== 'summary') {
      this.guidedStep = Math.min(this.guidedStep + 1, GUIDED_STAGES.length - 1);
      this.notify();
    }
    if (stage.id === 'summary') {
      this.notify();
    }
  }
  renderer: {
    setScenario: (s: Scenario) => void;
    setPlan: (p: PlanResult | null) => void;
    setSnapshot: (s: SimSnapshot, t: number) => void;
    setSelectedRobot: (id: string | null) => void;
    fitToMap: () => void;
    setTool: (tool: string, editMode: boolean) => void;
    setSelectedTasks: (ids: Set<string>, hoverId: string | null) => void;
    setLandingDrift: (on: boolean) => void;
    raw?: unknown;
  } | null = null;
  private raf = 0;
  private lastFrameTime = 0;

  presetList = presetSummaries();
  activePresetId = 'ecommerce';

  constructor() {
    this.validation = validateScenario(this.scenario);
    this.startPlaybackLoop();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;

  notify(): void {
    this.version++;
    this.renderer?.setTool(this.tool, this.mode === 'design' || (this.mode === 'simulate' && !this.playing));
    this.renderer?.setSelectedTasks(this.selectedTaskIds, this.hoveredPackageId);
    for (const l of this.listeners) l();
  }

  setHoveredPackage(id: string | null): void {
    this.hoveredPackageId = id;
    this.renderer?.setSelectedTasks(this.selectedTaskIds, id);
  }

  toast(kind: Toast['kind'], message: string): void {
    const t = { id: this.nextToastId++, kind, message };
    this.toasts = [...this.toasts.slice(-4), t];
    this.notify();
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.notify();
    }, 4200);
  }

  // ---------- lifecycle ----------

  loadPreset(id: string): void {
    if (!this.presetList.some((p) => p.id === id)) {
      this.toast('error', `Unknown warehouse "${id}" - previous warehouse kept.`);
      this.notify();
      return;
    }
    const sc = buildPreset(id);
    this.activePresetId = id;
    this.loadScenario(sc);
    this.toast('info', `Loaded ${sc.map.name} - ${sc.packages.length} packages, ${sc.robots.length} robots.`);
  }

  loadScenario(sc: Scenario): void {
    this.scenario = sc;
    this.sim = new Simulation(sc);
    this.planOutcome = null;
    this.planSummary = null;
    this.selectedTaskIds = new Set();
    this.selectedRobotIds = new Set(this.scenario.robots.slice(0, 2).map((r) => r.id));
    this.focusRobotId = null;
    this.playing = false;
    this.tickFloat = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.validation = validateScenario(sc);
    this.renderer?.setScenario(sc);
    this.renderer?.setPlan(null);
    if (this.mode !== 'overview') this.renderer?.fitToMap();
    else this.renderer?.setLandingDrift(true);
    this.notify();
  }

  setMode(mode: AppMode): void {
    this.mode = mode;
    if (mode === 'overview') {
      this.playing = false;
      this.renderer?.setLandingDrift(true);
    } else {
      this.renderer?.setLandingDrift(false);
      this.renderer?.fitToMap();
    }
    this.notify();
  }

  /** True when mission inputs (selection, fleet, map) changed after the plan was computed. */
  isPlanStale(): boolean {
    if (!this.planOutcome) return false;
    const fp = `${this.strategy}|` + missionFingerprint(this.scenario, [...this.selectedTaskIds], [...this.selectedRobotIds]);
    return fp !== this.planFingerprint;
  }

  setStrategy(strategy: 'insertion' | 'nearest'): void {
    if (this.strategy === strategy) return;
    this.invalidateIfRunning();
    this.strategy = strategy;
    this.notify();
  }

  /** Run both strategies on the SAME frozen scenario/selection/fleet and measure real runs. */
  runComparison(): void {
    if (this.selectedTaskIds.size === 0) {
      this.toast('warn', 'Select packages first, then compare.');
      return;
    }
    const tasks = [...this.selectedTaskIds];
    const fleetIds = [...this.selectedRobotIds];
    const dockCells = dockCellsOf(this.scenario.map);
    const rows: ComparisonRow[] = [];
    for (const key of ['insertion', 'nearest'] as const) {
      const outcome = createMissionPlan({
        map: this.scenario.map,
        dockCells,
        packages: this.scenario.packages,
        robots: this.scenario.robots.filter((r) => fleetIds.includes(r.id)).map((r) => ({ ...r, cell: r.homeCell })),
        idleRobotCells: this.scenario.robots.filter((r) => !fleetIds.includes(r.id)).map((r) => r.homeCell),
        selectedTaskIds: tasks,
        carriedByRobot: {},
        startTick: 0,
        strategy: key,
      });
      const sim = new Simulation(this.scenario);
      sim.applyPlan(outcome.plan, { replan: false, selectedCount: tasks.length });
      let guard = 0;
      while (sim.tickForward() && guard++ < 50000) { /* fast-forward */ }
      const snap = sim.snapshot(tasks.length);
      rows.push({
        key,
        name: outcome.strategyName,
        planningMs: outcome.plan.planningMs,
        plannedMakespan: outcome.plan.estimatedMakespanTicks,
        actualMakespan: snap.metrics.actualMakespanTicks,
        lastParked: snap.metrics.lastParkedTick,
        distanceMeters: snap.metrics.distanceMeters,
        trips: snap.metrics.trips,
        delivered: snap.metrics.delivered,
        selected: tasks.length,
        conflicts: snap.metrics.conflictsAvoided,
        failed: outcome.plan.failedRobots.length,
        perRobot: snap.robots.map((r) => ({ id: r.id, delivered: r.deliveriesDone, trips: r.tripsCompleted })),
      });
    }
    this.comparison = {
      ranAt: new Date().toISOString(),
      scenarioId: this.scenario.id,
      tasks: tasks.length,
      fleet: fleetIds.length,
      rows,
    };
    this.toast('success', 'Comparison complete - same scenario, selection and fleet for both strategies.');
    this.notify();
  }

  /** Selection/fleet changes must not silently ride along with a running plan. */
  private invalidateIfRunning(): void {
    if (this.playing || this.sim.status === 'running') {
      this.pause();
    }
  }

  // ---------- selection ----------

  toggleTask(id: string): void {
    this.invalidateIfRunning();
    if (this.selectedTaskIds.has(id)) this.selectedTaskIds.delete(id);
    else this.selectedTaskIds.add(id);
    this.notify();
  }

  selectSampleMission(count = 15): void {
    this.invalidateIfRunning();
    const m = sampleMission(this.scenario, count);
    this.selectedTaskIds = new Set(m.taskIds);
    this.selectedRobotIds = new Set(m.robotIds);
    this.toast('info', `Sample mission: ${m.taskIds.length} of ${this.scenario.packages.length} packages, ${m.robotIds.length} robots.`);
    this.notify();
  }

  clearTaskSelection(): void {
    this.invalidateIfRunning();
    this.selectedTaskIds = new Set();
    this.notify();
  }

  toggleRobot(id: string): void {
    this.invalidateIfRunning();
    if (this.selectedRobotIds.has(id)) {
      if (this.selectedRobotIds.size > 1) this.selectedRobotIds.delete(id);
    } else if (this.selectedRobotIds.size < MAX_FLEET) {
      this.selectedRobotIds.add(id);
    }
    this.notify();
  }

  setFleetSize(n: number): void {
    this.invalidateIfRunning();
    const ids = this.scenario.robots.slice(0, Math.max(1, Math.min(MAX_FLEET, n))).map((r) => r.id);
    this.selectedRobotIds = new Set(ids);
    this.notify();
  }

  focusRobot(id: string | null): void {
    this.focusRobotId = id;
    this.renderer?.setSelectedRobot(id);
    this.notify();
  }

  // ---------- planning ----------

  planMission(): void {
    const tasks = [...this.selectedTaskIds];
    if (tasks.length === 0) {
      this.toast('warn', 'Select at least one package to plan a mission.');
      return;
    }
    if (this.selectedRobotIds.size === 0) {
      this.toast('warn', 'Activate at least one robot.');
      return;
    }
    const errors = this.validation.filter((v) => v.level === 'error');
    if (errors.length > 0) {
      this.toast('error', `Cannot plan: ${errors[0].message}`);
      return;
    }
    const dockCells = dockCellsOf(this.scenario.map);
    const participating = this.scenario.robots.filter((r) => this.selectedRobotIds.has(r.id));
    const robots: RobotInstance[] = participating.map((r) => ({ ...r, cell: r.homeCell }));
    const idleCells = this.scenario.robots.filter((r) => !this.selectedRobotIds.has(r.id)).map((r) => r.homeCell);
    const outcome = createMissionPlan({
      map: this.scenario.map,
      dockCells,
      packages: this.scenario.packages,
      robots,
      idleRobotCells: idleCells,
      selectedTaskIds: tasks,
      carriedByRobot: {},
      startTick: 0,
      strategy: this.strategy,
    });
    this.applyPlanOutcome(outcome, false);
    const totalTasks = tasks.length;
    this.toast(
      'success',
      `Plan ready: ${totalTasks - outcome.unassigned.length}/${totalTasks} tasks assigned, estimated makespan ${Math.round(outcome.plan.estimatedMakespanTicks)} s (planning ${(outcome.plan.planningMs).toFixed(0)} ms).`,
    );
    if (outcome.unassigned.length > 0) {
      this.toast('warn', `${outcome.unassigned.length} task(s) unassigned: ${outcome.unassigned[0].reason}`);
    }
  }

  private applyPlanOutcome(outcome: MissionPlanOutcome, isReplan: boolean): void {
    this.planOutcome = outcome;
    this.planFingerprint = `${this.strategy}|` + missionFingerprint(
      this.scenario,
      [...this.selectedTaskIds],
      [...this.selectedRobotIds],
    );
    this.sim.applyPlan(outcome.plan, {
      replan: isReplan,
      selectedCount: this.selectedTaskIds.size,
    });
    this.tickFloat = this.sim.currentTick;
    const tripsByRobot: Record<string, { taskIds: string[]; dockCell: number }[]> = {};
    for (const a of outcome.plan.plans) {
      const alloc = outcome.plan.plans.length
        ? undefined
        : undefined;
      void alloc;
    }
    // trips come from the allocator's assignments - recover from planner outcome notes? Use plan refs:
    for (const rp of outcome.plan.plans) {
      const trips: { taskIds: string[]; dockCell: number }[] = [];
      for (const ue of rp.unloadEvents) trips.push({ taskIds: ue.taskIds, dockCell: ue.cell });
      tripsByRobot[rp.robotId] = trips;
    }
    this.planSummary = {
      strategyName: outcome.strategyName,
      planningMs: outcome.plan.planningMs,
      estimatedMakespanTicks: outcome.plan.estimatedMakespanTicks,
      conflictsAvoided: outcome.plan.conflictsAvoided,
      assignmentNotes: outcome.assignmentNotes,
      unassigned: outcome.unassigned,
      failedRobots: outcome.plan.failedRobots,
      tripsByRobot,
    };
    this.renderer?.setPlan(outcome.plan);
    this.notify();
  }

  // ---------- playback ----------

  play(): void {
    if (!this.planOutcome) {
      this.toast('warn', 'Plan a mission first.');
      return;
    }
    if (this.isPlanStale()) {
      this.toast('warn', 'Plan needs updating - recompute before running.');
      this.notify();
      return;
    }
    if (this.sim.status === 'finished') return;
    this.playing = true;
    this.sim.play();
    this.notify();
  }

  pause(): void {
    this.playing = false;
    this.sim.pause();
    this.notify();
  }

  step(n = 1): void {
    if (this.isPlanStale()) {
      this.toast('warn', 'Plan needs updating - recompute before stepping.');
      this.notify();
      return;
    }
    this.playing = false;
    this.sim.step(n);
    this.tickFloat = this.sim.currentTick;
    this.notify();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.notify();
  }

  resetMission(): void {
    this.playing = false;
    this.tickFloat = 0;
    // Fresh replay: restore packages, robots, and re-plan from tick 0 with the current selection.
    for (const p of this.scenario.packages) {
      if (this.selectedTaskIds.has(p.id)) p.state = 'unassigned';
    }
    this.sim.loadScenario(this.scenario);
    this.planOutcome = null;
    this.planSummary = null;
    this.planFingerprint = null;
    this.renderer?.setPlan(null);
    this.notify();
  }

  private startPlaybackLoop(): void {
    const loop = (t: number): void => {
      this.raf = requestAnimationFrame(loop);
      if (!this.lastFrameTime) this.lastFrameTime = t;
      const dt = Math.min(0.1, (t - this.lastFrameTime) / 1000);
      this.lastFrameTime = t;
      if (this.playing && this.planOutcome) {
        const prevTick = Math.floor(this.tickFloat);
        this.tickFloat += dt * this.speed / TICK_SECONDS;
        const newTick = Math.floor(this.tickFloat);
        for (let i = prevTick; i < newTick; i++) {
          if (!this.sim.tickForward()) break;
        }
        if (this.sim.status === 'finished') {
          this.playing = false;
          this.tickFloat = this.sim.currentTick;
          this.onMissionFinished();
        }
        if (newTick !== prevTick) this.notifyLight();
      }
      if (this.renderer) {
        this.renderer.setSnapshot(this.sim.snapshot(this.selectedTaskIds.size), this.tickFloat);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  private lightListeners = new Set<() => void>();
  subscribeLight = (cb: () => void): (() => void) => {
    this.lightListeners.add(cb);
    return () => this.lightListeners.delete(cb);
  };
  private notifyLight(): void {
    for (const l of this.lightListeners) l();
  }

  private onMissionFinished(): void {
    this.notify();
    const m = this.sim.snapshot(this.selectedTaskIds.size).metrics;
    if (m.delivered >= this.selectedTaskIds.size) {
      this.toast('success', `Mission complete - ${m.delivered} packages delivered in ${formatClock(m.actualMakespanTicks ?? this.sim.currentTick)}.`);
      if (this.guidedStep >= 0) this.guidedStep = 6;
    } else {
      this.toast('warn', `Mission ended: ${m.delivered}/${this.selectedTaskIds.size} delivered. Some tasks failed planning - see Analyze.`);
    }
  }

  // ---------- editing (design mode + paused interventions) ----------

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(scenarioToJson(this.scenario)));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private snapshotScenario(): string {
    return JSON.stringify(scenarioToJson(this.scenario));
  }

  private commitEdit(description: string, replan: boolean): void {
    this.scenario.map.revision++;
    this.validation = validateScenario(this.scenario);
    this.renderer?.setScenario(this.scenario);
    const errors = this.validation.filter((v) => v.level === 'error');
    if (errors.length > 0) {
      // roll back
      const json = this.undoStack.pop();
      if (json) {
        const sc = scenarioFromJson(JSON.parse(json));
        this.scenario = sc;
        this.sim.scenario = sc;
        this.renderer?.setScenario(sc);
        this.validation = validateScenario(sc);
      }
      this.toast('error', `Edit rejected: ${errors[0].message}`);
      this.notify();
      return;
    }
    if (replan && this.planOutcome) {
      this.replanFromCurrentState(description);
    } else {
      this.toast('success', description);
    }
    this.notify();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.snapshotScenario());
    const json = this.undoStack.pop()!;
    const sc = scenarioFromJson(JSON.parse(json));
    this.scenario = sc;
    this.sim.scenario = sc;
    this.validation = validateScenario(sc);
    this.renderer?.setScenario(sc);
    this.toast('info', 'Undid last edit.');
    this.notify();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.snapshotScenario());
    const json = this.redoStack.pop()!;
    const sc = scenarioFromJson(JSON.parse(json));
    this.scenario = sc;
    this.sim.scenario = sc;
    this.validation = validateScenario(sc);
    this.renderer?.setScenario(sc);
    this.notify();
  }

  /** Re-plan remaining work from the current tick, preserving carried/delivered state. */
  replanFromCurrentState(description: string): void {
    this.pause();
    const tick = this.sim.currentTick;
    const carried: Record<string, string[]> = {};
    const snap = this.sim.snapshot(this.selectedTaskIds.size);
    for (const [taskId, robotId] of Object.entries(snap.carriedBy)) {
      (carried[robotId] ??= []).push(taskId);
    }
    const dockCells = dockCellsOf(this.scenario.map);
    const participating = this.scenario.robots
      .filter((r) => this.selectedRobotIds.has(r.id) && !snap.robots.find((rv) => rv.id === r.id)?.finished);
    const robots: RobotInstance[] = participating.map((r) => {
      const rv = snap.robots.find((x) => x.id === r.id)!;
      return { ...r, cell: rv.cell };
    });
    const remaining = [...this.selectedTaskIds].filter((id) => {
      const st = snap.packageStates[id];
      return st !== 'delivered' && st !== 'carried';
    });
    if (remaining.length === 0 && Object.keys(carried).length === 0) {
      this.toast('info', `${description} Nothing left to replan.`);
      return;
    }
    const idleCells = this.scenario.robots
      .filter((r) => !this.selectedRobotIds.has(r.id))
      .map((r) => r.homeCell);
    const outcome = createMissionPlan({
      map: this.scenario.map,
      dockCells,
      packages: this.scenario.packages,
      robots,
      idleRobotCells: idleCells,
      selectedTaskIds: [...remaining, ...Object.values(carried).flat()],
      carriedByRobot: carried,
      startTick: tick,
    });
    this.applyPlanOutcome(outcome, true);
    this.toast(
      'success',
      `${description} Replanned from t+${tick}s for ${robots.length} robot(s), ${remaining.length + Object.values(carried).flat().length} remaining task(s) (${outcome.plan.planningMs.toFixed(0)} ms).`,
    );
  }

  /** Move a package to another (empty, serviceable) storage cell. */
  movePackage(taskId: string, targetCell: number): boolean {
    const p = this.scenario.packages.find((x) => x.id === taskId);
    if (!p) return false;
    const t = this.scenario.map.cells[targetCell];
    if (t !== CellType.Rack) {
      this.toast('error', 'Packages can only be placed inside rack storage cells.');
      return false;
    }
    if (this.scenario.packages.some((x) => x.cell === targetCell && x.id !== taskId)) {
      this.toast('error', 'That storage cell already holds a package.');
      return false;
    }
    // pickup must exist and be walkable
    const neighbors = [targetCell - 1, targetCell + 1, targetCell - this.scenario.map.width, targetCell + this.scenario.map.width];
    const walk = neighbors.find((n) => {
      const tt = this.scenario.map.cells[n];
      return tt === CellType.Floor || tt === CellType.Dock;
    });
    if (walk === undefined) {
      this.toast('error', 'No walkable service cell adjacent to that storage spot.');
      return false;
    }
    this.pushUndo();
    p.cell = targetCell;
    p.pickupCell = walk;
    this.commitEdit(`Moved ${taskId}.`, true);
    return true;
  }

  paintCell(cell: number, type: CellType.Rack | CellType.Floor): void {
    const cur = this.scenario.map.cells[cell];
    if (type === CellType.Rack) {
      if (cur !== CellType.Floor && cur !== CellType.Dock) {
        this.toast('error', 'Can only place racks on open floor.');
        return;
      }
      if (this.scenario.robots.some((r) => r.homeCell === cell)) {
        this.toast('error', 'A robot starts there. Move the robot first.');
        return;
      }
      this.pushUndo();
      this.scenario.map.cells[cell] = CellType.Rack;
      this.commitEdit('Placed rack segment.', this.mode === 'simulate');
    } else {
      if (cur !== CellType.Rack && cur !== CellType.Obstacle) {
        this.toast('error', 'Nothing to remove there.');
        return;
      }
      if (this.scenario.packages.some((p) => p.cell === cell)) {
        this.toast('error', 'Remove the package stored in that cell first.');
        return;
      }
      this.pushUndo();
      this.scenario.map.cells[cell] = CellType.Floor;
      this.commitEdit('Cleared to floor.', this.mode === 'simulate');
    }
  }

  addPackage(cell: number): void {
    if (this.scenario.map.cells[cell] !== CellType.Rack) {
      this.toast('error', 'Packages live inside rack storage cells.');
      return;
    }
    if (this.scenario.packages.some((p) => p.cell === cell)) {
      this.toast('error', 'That storage cell already holds a package.');
      return;
    }
    const neighbors = [cell - 1, cell + 1, cell - this.scenario.map.width, cell + this.scenario.map.width];
    const walk = neighbors.find((n) => {
      const tt = this.scenario.map.cells[n];
      return tt === CellType.Floor || tt === CellType.Dock;
    });
    if (walk === undefined) {
      this.toast('error', 'No walkable service cell adjacent to that spot.');
      return;
    }
    this.pushUndo();
    const n = this.scenario.packages.length + 1;
    this.scenario.packages.push({
      id: `P-${String(n).padStart(2, '0')}${n > 99 ? String(n) : ''}`,
      shape: 'carton',
      cell,
      pickupCell: walk,
      shelfLabel: 'Shelf',
      aisleLabel: `Aisle ${String.fromCharCode(65 + (walk % this.scenario.map.width))}${Math.floor(walk / this.scenario.map.width) + 1}`,
      state: 'unassigned',
      seed: Math.floor(Math.random() * 100000),
    });
    this.commitEdit('Package added.', false);
  }

  setRobotHome(robotId: string, cell: number): void {
    if (this.scenario.map.cells[cell] !== CellType.Floor) {
      this.toast('error', 'Robot start must be open floor.');
      return;
    }
    if (this.scenario.robots.some((x) => x.id !== robotId && x.homeCell === cell)) {
      this.toast('error', 'Another robot already parks there.');
      return;
    }
    this.pushUndo();
    const r = this.scenario.robots.find((x) => x.id === robotId);
    if (r) r.homeCell = cell;
    this.commitEdit(`${robotId} parking bay moved.`, false);
  }

  // ---------- canvas interaction ----------

  onCellClick(cell: number, shift: boolean): void {
    void shift;
    const pkg = this.scenario.packages.find((p) => p.cell === cell);
    const robotCell = this.scenario.robots.find((r) => {
      if (this.planOutcome) {
        const rv = this.sim.snapshot(0).robots.find((x) => x.id === r.id);
        return rv ? rv.cell === cell : r.homeCell === cell;
      }
      return r.homeCell === cell;
    });
    if (this.mode === 'design' || (this.mode === 'simulate' && !this.playing && this.tool !== 'select')) {
      if (this.tool === 'rack') this.paintCell(cell, CellType.Rack);
      else if (this.tool === 'erase') this.paintCell(cell, CellType.Floor);
      else if (this.tool === 'package') this.addPackage(cell);
      else if (this.tool === 'move' && pkg) {
        this.movingPackageId = pkg.id;
        this.toast('info', `Moving ${pkg.id} - click a target storage cell.`);
        this.notify();
      } else if (this.tool === 'move' && this.movingPackageId) {
        const id = this.movingPackageId;
        this.movingPackageId = null;
        this.movePackage(id, cell);
      }
      return;
    }
    if (pkg) {
      if (this.mode === 'plan') this.toggleTask(pkg.id);
      else this.focusPackageInfo(pkg.id);
    } else if (robotCell) {
      this.focusRobot(robotCell.id);
    }
  }

  private focusPackageInfo(_taskId: string): void {
    void _taskId;
  }

  // ---------- persistence ----------

  saveCustom(name: string): void {
    const customs = this.listCustoms();
    const entry = { id: `custom-${Date.now()}`, name, savedAt: new Date().toISOString(), data: scenarioToJson(this.scenario) };
    customs.push(entry);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customs));
      this.toast('success', `Saved layout "${name}".`);
    } catch (e) {
      this.toast('error', `Save failed: ${String(e)}`);
    }
    this.notify();
  }

  listCustoms(): { id: string; name: string; savedAt: string; data: unknown }[] {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      return raw ? (JSON.parse(raw) as { id: string; name: string; savedAt: string; data: unknown }[]) : [];
    } catch {
      return [];
    }
  }

  loadCustom(id: string): void {
    const c = this.listCustoms().find((x) => x.id === id);
    if (!c) {
      this.activePresetId = this.activePresetId.startsWith('custom:') ? 'ecommerce' : this.activePresetId;
      this.toast('error', `Saved layout "${id}" was not found - previous warehouse kept.`);
      this.notify();
      return;
    }
    try {
      const sc = scenarioFromJson(c.data);
      this.loadScenario(sc);
      this.activePresetId = `custom:${id}`;
      this.toast('success', `Loaded saved layout "${c.name}".`);
    } catch (e) {
      this.toast('error', `Load failed: ${String(e)}`);
    }
    this.notify();
  }

  exportScenarioFile(): void {
    downloadFile(`${this.scenario.id}-scenario.json`, JSON.stringify(scenarioToJson(this.scenario), null, 2), 'application/json');
    this.toast('success', 'Scenario JSON exported.');
  }

  importScenarioFile(text: string): void {
    try {
      const sc = scenarioFromJson(JSON.parse(text));
      this.loadScenario(sc);
      this.toast('success', `Imported "${sc.map.name}".`);
    } catch (e) {
      this.toast('error', `Import failed: ${String(e)}`);
    }
  }

  exportRunJson(): void {
    const snap = this.sim.snapshot(this.selectedTaskIds.size);
    const data = {
      exportedAt: new Date().toISOString(),
      scenarioId: this.scenario.id,
      strategy: this.planSummary?.strategyName,
      planningMs: this.planSummary?.planningMs,
      seedNote: 'deterministic replay - same scenario+selection+fleet produce identical results',
      scenario: scenarioToJson(this.scenario),
      selection: { tasks: [...this.selectedTaskIds], robots: [...this.selectedRobotIds] },
      events: snap.events,
      metrics: snap.metrics,
    };
    downloadFile(`roboarena-run-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
    this.toast('success', 'Run JSON exported.');
  }

  exportRunCsv(): void {
    const snap = this.sim.snapshot(this.selectedTaskIds.size);
    const rows: string[] = ['robot_id,type,delivered,trips,distance_m,wait_ticks,cargo_at_end,final_state'];
    for (const rv of snap.robots) {
      rows.push([rv.id, rv.type, rv.deliveriesDone, rv.tripsCompleted, rv.distanceMeters, rv.waitTicks, rv.cargo.length, rv.state].join(','));
    }
    rows.push('');
    rows.push(`summary,,,,makespan_s=${snap.metrics.actualMakespanTicks ?? ''},planned_makespan_s=${snap.metrics.plannedMakespanTicks ?? ''},planning_ms=${snap.metrics.planningMs.toFixed(1)},conflicts_avoided=${snap.metrics.conflictsAvoided},distance_m=${snap.metrics.distanceMeters}`);
    downloadFile(`roboarena-run-${Date.now()}.csv`, rows.join('\n'), 'text/csv');
    this.toast('success', 'Run CSV exported.');
  }

}

export interface GuidedStage {
  id: string;
  title: string;
  auto: boolean;
  text: (s: AppStore) => string;
}

export const GUIDED_STAGES: GuidedStage[] = [
  {
    id: 'intro',
    title: 'The mission',
    auto: false,
    text: (s) =>
      `We picked ${s.selectedTaskIds.size} of ${s.scenario.packages.length} packages and activated ${s.selectedRobotIds.size} robots: ` +
      [...s.selectedRobotIds].map((id) => `${id} (${s.scenario.robots.find((r) => r.id === id)?.type === 'H10' ? 'Hauler, 10 per trip' : 'Scout, 1 per trip'})`).join(' and ') +
      '. Watch how the planner decides who carries what - then pause anytime to inspect.',
  },
  {
    id: 'assignment',
    title: 'Who carries what',
    auto: true,
    text: (s) => {
      const parts = Object.entries(s.planSummary?.tripsByRobot ?? {}).map(([id, trips]) => `${id}: ${trips.length} trip${trips.length > 1 ? 's' : ''}, ${trips.reduce((n, t) => n + t.taskIds.length, 0)} tasks`);
      return `The planner tested "give this task to that robot" for every option and kept the lowest predicted finish time. Result: ${parts.join('; ')}. It is a fast heuristic - not a proven optimum.`;
    },
  },
  {
    id: 'movement',
    title: 'Robots roll out',
    auto: true,
    text: () => 'Robots follow their reserved routes cell by cell. Dashed lines are the plan; the faint solid trail is where they actually went.',
  },
  {
    id: 'pickup',
    title: 'First pickup',
    auto: true,
    text: () => 'At the shelf slot, a robot pauses for its load dwell: the package slides out of the rack and onto the robot - the slot visibly empties. A Hauler can collect up to ten before heading back.',
  },
  {
    id: 'delivery',
    title: 'Unloading at the dock',
    auto: true,
    text: () => 'A trip only completes when cargo is unloaded at the dock - delivered crates stack up at the station and the counter advances. Only then does the job count.',
  },
  {
    id: 'avoidance',
    title: 'Waiting its turn',
    auto: false,
    text: (s) => {
      const n = s.planSummary ? s.planSummary.conflictsAvoided ?? 0 : 0;
      const waits = s.sim.snapshot(s.selectedTaskIds.size).metrics.conflictsAvoided;
      if (n === 0 && waits === 0) {
        return 'No conflicts occurred on this run - the reservation planner booked every cell ahead of time. Amber pause markers would appear on the route if a robot had to wait its turn.';
      }
      return `The planner inserted ${Math.max(n, waits)} wait(s) where two routes would have crossed. Look for the amber pause markers - robots hold position instead of colliding.`;
    },
  },
  {
    id: 'return',
    title: 'Back to the bay',
    auto: true,
    text: () => 'After its last unload, each robot returns to its own parking bay in the charging zone. The mission is measured at the last delivery; the last robot reaching its bay is reported separately.',
  },
  {
    id: 'summary',
    title: 'Mission summary',
    auto: false,
    text: (s) => {
      const m = s.sim.snapshot(s.selectedTaskIds.size).metrics;
      return `Delivered ${m.delivered}/${m.selected} packages in ${formatClock(m.actualMakespanTicks ?? 0)} (planned ${m.plannedMakespanTicks !== null ? formatClock(m.plannedMakespanTicks) : '-'}), ${m.distanceMeters.toFixed(0)} m travelled, ${m.trips} dock trips, ${m.conflictsAvoided} planned waits. Replay with Reset to see the identical run again.`;
    },
  },
];

export function formatClock(tick: number): string {
  const total = Math.max(0, Math.floor(tick * TICK_SECONDS));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const store = new AppStore();
void PRESETS;
