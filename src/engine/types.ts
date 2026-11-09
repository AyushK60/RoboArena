// Core domain types. The engine is pure data-in/data-out; nothing here imports React or PixiJS.

export type Dir = 0 | 1 | 2 | 3; // 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x)

export enum CellType {
  Floor = 0,
  Rack = 1,
  Obstacle = 2,
  Dock = 3,
  Wall = 4,
}

export type PackageShape = 'carton' | 'pallet' | 'beam' | 'coil' | 'crate' | 'bag';

export type PackageState = 'unassigned' | 'assigned' | 'carried' | 'delivered' | 'unreachable';

export type ZoneKind =
  | 'receiving'
  | 'shipping'
  | 'packing'
  | 'charging'
  | 'restricted'
  | 'staging'
  | 'sorting'
  | 'storage';

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShelfRun {
  id: string; // e.g. "S-3"
  label: string; // e.g. "Shelf 2-1"
  x: number;
  y: number;
  w: number;
  h: number; // occupied (blocked) cells
  orient: 'v' | 'h';
  style: number; // art variation seed 0..2
}

export interface Truck {
  id: string;
  x: number;
  y: number;
  orient: 'v' | 'h';
  kind: 'box' | 'flatbed';
}

export interface WarehouseMapData {
  id: string;
  name: string;
  subtitle: string;
  width: number;
  height: number;
  revision: number;
  cells: Uint8Array; // width*height, CellType
  zones: Zone[];
  shelfRuns: ShelfRun[];
  trucks: Truck[];
  chargeCells: number[]; // decorative charging pads (walkable)
}

export interface PackageData {
  id: string; // "P-01"
  shape: PackageShape;
  cell: number; // storage cell (may be a blocked rack cell; visual anchor)
  pickupCell: number; // walkable service cell adjacent to storage
  shelfLabel: string; // "Shelf 2-1"
  aisleLabel: string; // "Aisle D-5"
  state: PackageState;
  seed: number; // stable art-variation seed
}

export type RobotType = 'S1' | 'H10';

export interface RobotData {
  id: string; // "R-01"
  type: RobotType;
  capacity: number; // S1=1, H10=10
  homeCell: number;
}

/** A robot placed in a mission: scenario data plus its current logical cell. */
export type RobotInstance = RobotData & { cell: number };

export interface Scenario {
  schemaVersion: number;
  id: string;
  map: WarehouseMapData;
  packages: PackageData[];
  robots: RobotData[];
}

// ---------- planning ----------

export interface TripPlan {
  taskIds: string[]; // ordered pickups within one dock-to-dock trip
  dockCell: number;
}

export interface RobotAssignment {
  robotId: string;
  trips: TripPlan[];
  estimatedFinishTicks: number;
  note: string;
}

export interface AllocationResult {
  assignments: RobotAssignment[];
  unassigned: { taskId: string; reason: string }[];
  estimatedMakespanTicks: number;
  strategyId: string;
  planningMs: number;
}

export interface PathStep {
  cell: number;
  arriveTick: number;
  departTick: number; // arriveTick + dwell/wait; transit to next cell takes MOVE_TICKS
  wait: boolean; // inserted by the reservation planner to avoid a conflict
}

export interface RobotPlan {
  robotId: string;
  steps: PathStep[];
  finishTick: number; // tick of final unload completion
  parkTick: number | null; // tick the robot is back at its home bay (null when no park leg)
  pickupEvents: { tick: number; taskId: string; cell: number }[];
  unloadEvents: { tick: number; taskIds: string[]; cell: number; tripIndex: number }[];
  dwellSteps: { stepIndex: number; kind: 'pickup' | 'unload' }[]; // for state derivation
}

export interface PlanResult {
  plans: RobotPlan[];
  idlePlans: { robotId: string; steps: PathStep[] }[]; // non-participating robots making way
  failedRobots: { robotId: string; reason: string }[];
  taskStates: Record<string, 'assigned' | 'unreachable'>;
  estimatedMakespanTicks: number;
  planningMs: number;
  conflictsAvoided: number; // wait steps forced by reservations
}

// ---------- runtime ----------

export type RobotSimState =
  | 'idle'
  | 'moving'
  | 'pickingUp'
  | 'toDock'
  | 'unloading'
  | 'waiting'
  | 'parking'
  | 'parked'
  | 'done';

export type EventKind =
  | 'mission_start'
  | 'pickup'
  | 'trip_complete'
  | 'robot_done'
  | 'mission_complete'
  | 'replan'
  | 'edit'
  | 'planning_failed';

export interface ScheduledEvent {
  tick: number;
  kind: EventKind;
  robotId?: string;
  taskId?: string;
  message: string;
}

export interface RobotView {
  id: string;
  type: RobotType;
  capacity: number;
  cell: number;
  prevCell: number; // cell it moved from (for interpolation)
  moveFraction: number; // 0..1 progress between prevCell and cell
  dir: Dir;
  state: RobotSimState;
  cargo: string[];
  tripsCompleted: number;
  pickupsDone: number;
  deliveriesDone: number;
  distanceMeters: number;
  waitTicks: number;
  finished: boolean;
  dwellTotal: number; // ticks in current dwell (for progress ring), 0 if none
}

export interface Metrics {
  selected: number;
  picked: number;
  delivered: number;
  trips: number;
  distanceMeters: number;
  waitTicks: number;
  actualMakespanTicks: number | null; // last delivery
  lastParkedTick: number | null; // when the last robot is back at its bay
  plannedMakespanTicks: number | null;
  conflictsAvoided: number;
  planningMs: number;
  perRobot: Record<
    string,
    {
      delivered: number;
      trips: number;
      distanceMeters: number;
      waitTicks: number;
      state: RobotSimState;
      cargoCount: number;
    }
  >;
}

export interface SimSnapshot {
  tick: number;
  timeSeconds: number;
  status: 'idle' | 'ready' | 'running' | 'paused' | 'finished';
  robots: RobotView[];
  packageStates: Record<string, PackageState>;
  carriedBy: Record<string, string>; // taskId -> robotId
  events: ScheduledEvent[]; // newest last, capped
  metrics: Metrics;
  hasPlan: boolean;
}
