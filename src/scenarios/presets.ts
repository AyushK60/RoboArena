// Four distinct warehouse presets. Real serialized objects — every package has a storage cell,
// a walkable pickup service cell, and reachable docks (asserted by tests).
import { mulberry32 } from '../engine/rng';
import { CellType, type PackageData, type PackageShape, type RobotData, type Scenario, type ShelfRun, type Truck, type WarehouseMapData, type Zone } from '../engine/types';
import { idx } from '../engine/grid';

export interface VRunSpec {
  x: number;
  y0: number;
  y1: number;
  w?: number;
}
export interface HRunSpec {
  y: number;
  x0: number;
  x1: number;
  h?: number;
}

export interface PresetSpec {
  id: string;
  name: string;
  subtitle: string;
  width: number;
  height: number;
  vRuns: VRunSpec[];
  hRuns: HRunSpec[];
  dockCells: [number, number][];
  zones: Zone[];
  trucks: Truck[];
  chargeCells: [number, number][];
  robotHomes: [number, number][];
  packageCount: number;
  shapes: [PackageShape, number][]; // shape, weight
  seed: number;
}

function buildMap(spec: PresetSpec): { map: WarehouseMapData; shelfRuns: ShelfRun[] } {
  const cells = new Uint8Array(spec.width * spec.height).fill(CellType.Floor);
  const wall = (x: number, y: number) => {
    cells[idx({ width: spec.width }, x, y)] = CellType.Wall;
  };
  for (let x = 0; x < spec.width; x++) {
    wall(x, 0);
    wall(x, spec.height - 1);
  }
  for (let y = 0; y < spec.height; y++) {
    wall(0, y);
    wall(spec.width - 1, y);
  }
  const shelfRuns: ShelfRun[] = [];
  let runIdx = 0;
  const runCol = new Map<number, number>();
  for (const r of spec.vRuns) {
    const w = r.w ?? 1;
    for (let yy = r.y0; yy <= r.y1; yy++) {
      for (let xx = r.x; xx < r.x + w; xx++) {
        cells[idx({ width: spec.width }, xx, yy)] = CellType.Rack;
      }
    }
    runCol.set(r.x, runIdx);
    shelfRuns.push({
      id: `S-${runIdx + 1}`,
      label: `Shelf ${runIdx + 1}-${w > 1 ? 2 : 1}`,
      x: r.x,
      y: r.y0,
      w,
      h: r.y1 - r.y0 + 1,
      orient: 'v',
      style: runIdx % 3,
    });
    runIdx++;
  }
  for (const r of spec.hRuns) {
    const h = r.h ?? 1;
    for (let yy = r.y; yy < r.y + h; yy++) {
      for (let xx = r.x0; xx <= r.x1; xx++) {
        cells[idx({ width: spec.width }, xx, yy)] = CellType.Rack;
      }
    }
    shelfRuns.push({
      id: `S-${runIdx + 1}`,
      label: `Shelf ${runIdx + 1}-L`,
      x: r.x0,
      y: r.y,
      w: r.x1 - r.x0 + 1,
      h,
      orient: 'h',
      style: runIdx % 3,
    });
    runIdx++;
  }
  for (const [dx, dy] of spec.dockCells) cells[idx({ width: spec.width }, dx, dy)] = CellType.Dock;
  for (const [cx, cy] of spec.chargeCells) {
    // charging pads stay walkable
    if (cells[idx({ width: spec.width }, cx, cy)] === CellType.Rack) cells[idx({ width: spec.width }, cx, cy)] = CellType.Floor;
  }
  const map: WarehouseMapData = {
    id: spec.id,
    name: spec.name,
    subtitle: spec.subtitle,
    width: spec.width,
    height: spec.height,
    revision: 1,
    cells,
    zones: spec.zones,
    shelfRuns,
    trucks: spec.trucks,
    chargeCells: spec.chargeCells.map(([x, y]) => idx({ width: spec.width }, x, y)),
  };
  return { map, shelfRuns };
}

function pickShape(rnd: () => number, shapes: [PackageShape, number][]): PackageShape {
  const total = shapes.reduce((n, s) => n + s[1], 0);
  let v = rnd() * total;
  for (const [shape, wt] of shapes) {
    v -= wt;
    if (v <= 0) return shape;
  }
  return shapes[0][0];
}

function buildPackages(spec: PresetSpec, map: WarehouseMapData, shelfRuns: ShelfRun[]): PackageData[] {
  const rnd = mulberry32(spec.seed);
  // storage cells in run order, row-major for v-runs (spread across runs), x-major for h-runs
  const vCells: { cell: number; run: ShelfRun }[] = [];
  const hCells: { cell: number; run: ShelfRun }[] = [];
  for (const run of shelfRuns) {
    for (let yy = 0; yy < run.h; yy++) {
      for (let xx = 0; xx < run.w; xx++) {
        const cell = (run.y + yy) * map.width + (run.x + xx);
        (run.orient === 'v' ? vCells : hCells).push({ cell, run });
      }
    }
  }
  const ordered: { cell: number; run: ShelfRun }[] = [];
  const vByRow = new Map<number, { cell: number; run: ShelfRun }[]>();
  for (const vc of vCells) {
    const y = Math.floor(vc.cell / map.width);
    (vByRow.get(y) ?? vByRow.set(y, []).get(y)!).push(vc);
  }
  const hByCol = new Map<number, { cell: number; run: ShelfRun }[]>();
  for (const hc of hCells) {
    const x = hc.cell % map.width;
    (hByCol.get(x) ?? hByCol.set(x, []).get(x)!).push(hc);
  }
  const vRows = [...vByRow.keys()];
  const hCols = [...hByCol.keys()];
  const maxLen = Math.max(vRows.length, hCols.length);
  for (let i = 0; i < maxLen; i++) {
    const vr = vByRow.get(vRows[i % Math.max(1, vRows.length)]);
    if (vr && i < vRows.length) ordered.push(...vr);
    const hc = hByCol.get(hCols[i % Math.max(1, hCols.length)]);
    if (hc && i < hCols.length) ordered.push(...hc);
  }
  const packages: PackageData[] = [];
  const count = Math.min(spec.packageCount, ordered.length);
  const used = new Set<number>();
  for (const { cell, run } of ordered) {
    if (packages.length >= count) break;
    if (used.has(cell)) continue;
    used.add(cell);
    // pickup: left/north neighbor preferred, else right/south
    const x = cell % map.width;
    const y = Math.floor(cell / map.width);
    let pickup = -1;
    if (run.orient === 'v') {
      if (map.cells[cell - 1] === CellType.Floor || map.cells[cell - 1] === CellType.Dock) pickup = cell - 1;
      else if (map.cells[cell + 1] === CellType.Floor) pickup = cell + 1;
    } else {
      if (map.cells[cell - map.width] === CellType.Floor || map.cells[cell - map.width] === CellType.Dock) pickup = cell - map.width;
      else if (map.cells[cell + map.width] === CellType.Floor) pickup = cell + map.width;
    }
    if (pickup < 0) continue;
    if (x === 0 || y === 0) continue;
    const runNum = parseInt(run.id.replace('S-', ''), 10);
    packages.push({
      id: `P-${String(packages.length + 1).padStart(2, '0')}`,
      shape: pickShape(rnd, spec.shapes),
      cell,
      pickupCell: pickup,
      shelfLabel: run.label,
      aisleLabel: `Aisle ${String.fromCharCode(65 + (pickup % map.width))}${Math.floor(pickup / map.width) + 1}`,
      state: 'unassigned',
      seed: Math.floor(rnd() * 100000),
    });
    void runNum;
  }
  return packages;
}

function buildScenario(spec: PresetSpec): Scenario {
  const { map, shelfRuns } = buildMap(spec);
  const packages = buildPackages(spec, map, shelfRuns);
  const caps = { S1: 1, H10: 10 } as const;
  const types: ('S1' | 'H10')[] = spec.robotHomes.map((_, i) => (i % 3 === 2 ? 'H10' : i % 2 === 0 ? 'H10' : 'S1'));
  const robots: RobotData[] = spec.robotHomes.map(([x, y], i) => ({
    id: `R-${String(i + 1).padStart(2, '0')}`,
    type: types[i],
    capacity: caps[types[i]],
    homeCell: idx({ width: spec.width }, x, y),
  }));
  return {
    schemaVersion: 1,
    id: spec.id,
    map,
    packages,
    robots,
  };
}

// ---------------- Preset 1: E-commerce Fulfillment (60x40) ----------------
const ecommerce: PresetSpec = {
  id: 'ecommerce',
  name: 'E-commerce Warehouse',
  subtitle: 'Large fulfillment center (60 × 40)',
  width: 60,
  height: 40,
  vRuns: (() => {
    const runs: VRunSpec[] = [];
    for (let k = 0; k < 14; k++) {
      const x = 8 + k * 3;
      if (x + 1 > 51) break;
      runs.push({ x, y0: 5, y1: 14, w: 2 });
      runs.push({ x, y0: 25, y1: 34, w: 2 });
    }
    return runs;
  })(),
  hRuns: [],
  dockCells: Array.from({ length: 6 }, (_, i) => [1, 17 + i] as [number, number]).concat(
    Array.from({ length: 6 }, (_, i) => [58, 29 + i] as [number, number]),
  ),
  zones: [
    { id: 'z-rec', name: 'Receiving', kind: 'receiving', x: 1, y: 15, w: 6, h: 10 },
    { id: 'z-pack', name: 'Packing Station', kind: 'packing', x: 51, y: 3, w: 8, h: 11 },
    { id: 'z-ship', name: 'Shipping', kind: 'shipping', x: 51, y: 26, w: 8, h: 11 },
    { id: 'z-chg', name: 'Charging Docks', kind: 'charging', x: 1, y: 27, w: 5, h: 8 },
    { id: 'z-res', name: 'Restricted Zone (Keep Clear)', kind: 'restricted', x: 9, y: 36, w: 22, h: 3 },
  ],
  trucks: [
    { id: 'T1', x: 2, y: 11, orient: 'v', kind: 'box' },
    { id: 'T2', x: 55, y: 35, orient: 'h', kind: 'box' },
  ],
  chargeCells: [
    [2, 29], [2, 30], [2, 31], [2, 32],
    [3, 29], [3, 30], [3, 31], [3, 32],
  ],
  robotHomes: [
    [2, 29], [2, 30], [2, 31], [2, 32], [3, 29], [3, 30], [3, 31], [3, 32],
  ],
  packageCount: 66,
  shapes: [['carton', 8], ['bag', 1], ['crate', 1]],
  seed: 41001,
};

// ---------------- Preset 2: Steel & Raw Materials (54x38) ----------------
const steel: PresetSpec = {
  id: 'steel',
  name: 'Steel & Raw Materials',
  subtitle: 'Heavy goods depot (54 × 38)',
  width: 54,
  height: 38,
  vRuns: (() => {
    const runs: VRunSpec[] = [];
    for (let k = 0; k < 10; k++) {
      const x = 7 + k * 4;
      if (x + 1 > 42) break;
      runs.push({ x, y0: 4, y1: 13, w: 2 });
      runs.push({ x, y0: 18, y1: 27, w: 2 });
    }
    return runs;
  })(),
  hRuns: [
    { y: 31, x0: 7, x1: 40, h: 2 },
    { y: 34, x0: 7, x1: 34, h: 2 },
  ],
  dockCells: Array.from({ length: 5 }, (_, i) => [1, 16 + i] as [number, number]).concat(
    Array.from({ length: 5 }, (_, i) => [52, 16 + i] as [number, number]),
  ),
  zones: [
    { id: 'z-rec', name: 'Receiving', kind: 'receiving', x: 1, y: 14, w: 5, h: 10 },
    { id: 'z-ship', name: 'Shipping', kind: 'shipping', x: 48, y: 14, w: 5, h: 10 },
    { id: 'z-stage', name: 'Coil Staging', kind: 'staging', x: 2, y: 3, w: 5, h: 9 },
    { id: 'z-heavy', name: 'Heavy Bay', kind: 'storage', x: 44, y: 3, w: 9, h: 9 },
    { id: 'z-res', name: 'Restricted Zone (Keep Clear)', kind: 'restricted', x: 18, y: 30, w: 16, h: 2 },
    { id: 'z-chg', name: 'Charging Docks', kind: 'charging', x: 2, y: 31, w: 4, h: 6 },
  ],
  trucks: [
    { id: 'T1', x: 2, y: 9, orient: 'v', kind: 'flatbed' },
    { id: 'T2', x: 48, y: 35, orient: 'h', kind: 'flatbed' },
  ],
  chargeCells: [
    [3, 32], [3, 33], [3, 34],
    [4, 32], [4, 33], [4, 34],
  ],
  robotHomes: [
    [3, 32], [3, 33], [3, 34], [4, 32], [4, 33], [4, 34],
  ],
  packageCount: 60,
  shapes: [['beam', 4], ['coil', 4], ['crate', 3], ['pallet', 3]],
  seed: 42002,
};

// ---------------- Preset 3: Construction Supply (50x36) ----------------
const construction: PresetSpec = {
  id: 'construction',
  name: 'Construction Supply',
  subtitle: 'Mixed materials yard (50 × 36)',
  width: 50,
  height: 36,
  vRuns: (() => {
    const runs: VRunSpec[] = [];
    for (let k = 0; k < 9; k++) {
      const x = 7 + k * 4;
      if (x + 1 > 40) break;
      runs.push({ x, y0: 4, y1: 12, w: 2 });
      runs.push({ x, y0: 17, y1: 25, w: 2 });
    }
    return runs;
  })(),
  hRuns: [
    { y: 28, x0: 7, x1: 38, h: 2 },
    { y: 4, x0: 30, x1: 43, h: 3 },
  ],
  dockCells: Array.from({ length: 5 }, (_, i) => [1, 14 + i] as [number, number]).concat(
    Array.from({ length: 5 }, (_, i) => [48, 14 + i] as [number, number]),
  ),
  zones: [
    { id: 'z-rec', name: 'Receiving', kind: 'receiving', x: 1, y: 12, w: 5, h: 9 },
    { id: 'z-ship', name: 'Shipping', kind: 'shipping', x: 44, y: 12, w: 5, h: 9 },
    { id: 'z-lumber', name: 'Lumber Storage', kind: 'storage', x: 29, y: 3, w: 15, h: 5 },
    { id: 'z-cement', name: 'Cement & Aggregate', kind: 'storage', x: 7, y: 31, w: 18, h: 4 },
    { id: 'z-res', name: 'Restricted Zone (Keep Clear)', kind: 'restricted', x: 26, y: 31, w: 14, h: 3 },
    { id: 'z-chg', name: 'Charging Docks', kind: 'charging', x: 2, y: 29, w: 4, h: 6 },
  ],
  trucks: [
    { id: 'T1', x: 2, y: 8, orient: 'v', kind: 'flatbed' },
    { id: 'T2', x: 44, y: 33, orient: 'h', kind: 'box' },
  ],
  chargeCells: [
    [3, 30], [3, 31], [3, 32], [3, 33],
    [4, 30], [4, 31], [4, 32], [4, 33],
  ],
  robotHomes: [
    [3, 30], [3, 31], [3, 32], [3, 33], [4, 30], [4, 31], [4, 32], [4, 33],
  ],
  packageCount: 60,
  shapes: [['pallet', 5], ['bag', 4], ['beam', 3], ['crate', 2]],
  seed: 43003,
};

// ---------------- Preset 4: Cross-Docking Distribution (64x36) ----------------
const crossdock: PresetSpec = {
  id: 'crossdock',
  name: 'Cross-Docking Hub',
  subtitle: 'Distribution center (64 × 36)',
  width: 64,
  height: 36,
  vRuns: (() => {
    const runs: VRunSpec[] = [];
    for (let k = 0; k < 7; k++) {
      const x = 5 + k * 3;
      if (x + 1 > 24) break;
      runs.push({ x, y0: 4, y1: 11, w: 2 });
    }
    for (let k = 0; k < 6; k++) {
      const x = 42 + k * 3;
      if (x + 1 > 58) break;
      runs.push({ x, y0: 24, y1: 31, w: 2 });
    }
    return runs;
  })(),
  hRuns: [
    { y: 14, x0: 27, x1: 38, h: 1 },
    { y: 17, x0: 27, x1: 38, h: 1 },
    { y: 20, x0: 27, x1: 38, h: 1 },
  ],
  dockCells: Array.from({ length: 8 }, (_, i) => [1, 9 + i * 2] as [number, number]).concat(
    Array.from({ length: 8 }, (_, i) => [62, 9 + i * 2] as [number, number]),
  ),
  zones: [
    { id: 'z-rec', name: 'Receiving Bay', kind: 'receiving', x: 1, y: 6, w: 4, h: 22 },
    { id: 'z-sort', name: 'Sorting', kind: 'sorting', x: 5, y: 3, w: 22, h: 3 },
    { id: 'z-stage', name: 'Staging Lanes', kind: 'staging', x: 26, y: 13, w: 14, h: 9 },
    { id: 'z-disp', name: 'Dispatch', kind: 'shipping', x: 59, y: 6, w: 4, h: 22 },
    { id: 'z-res', name: 'Restricted Zone (Keep Clear)', kind: 'restricted', x: 27, y: 30, w: 20, h: 2 },
    { id: 'z-chg', name: 'Charging Docks', kind: 'charging', x: 27, y: 3, w: 4, h: 8 },
  ],
  trucks: [
    { id: 'T1', x: 2, y: 6, orient: 'v', kind: 'box' },
    { id: 'T2', x: 60, y: 29, orient: 'v', kind: 'box' },
  ],
  chargeCells: [
    [28, 4], [28, 5], [28, 6], [28, 7], [28, 8],
    [29, 4], [29, 5], [29, 6], [29, 7], [29, 8],
  ],
  robotHomes: [
    [28, 4], [28, 5], [28, 6], [28, 7], [28, 8],
    [29, 4], [29, 5], [29, 6], [29, 7], [29, 8],
  ],
  packageCount: 76,
  shapes: [['carton', 7], ['bag', 2], ['crate', 1]],
  seed: 44004,
};

export const PRESETS: { spec: PresetSpec; build: () => Scenario }[] = [
  { spec: ecommerce, build: () => buildScenario(ecommerce) },
  { spec: steel, build: () => buildScenario(steel) },
  { spec: construction, build: () => buildScenario(construction) },
  { spec: crossdock, build: () => buildScenario(crossdock) },
];

export function buildPreset(id: string): Scenario {
  const p = PRESETS.find((x) => x.spec.id === id) ?? PRESETS[0];
  return p.build();
}

export function presetSummaries(): { id: string; name: string; subtitle: string }[] {
  return PRESETS.map((p) => ({ id: p.spec.id, name: p.spec.name, subtitle: p.spec.subtitle }));
}

/** Sample mission: first N packages spread across the map, two robots (S1 + H10). */
export function sampleMission(sc: Scenario, count = 15): { taskIds: string[]; robotIds: string[] } {
  const step = Math.max(1, Math.floor(sc.packages.length / count));
  const taskIds: string[] = [];
  for (let i = 0; i < sc.packages.length && taskIds.length < count; i += step) {
    taskIds.push(sc.packages[i].id);
  }
  const robotIds = [sc.robots[0].id, sc.robots[1].id].filter(Boolean);
  return { taskIds, robotIds };
}
