// Tiny deterministic warehouse used by the engine test-suite. Not a UI preset.
import { mulberry32 } from '../engine/rng';
import { CellType, type PackageData, type PackageShape, type RobotData, type Scenario, type ShelfRun, type WarehouseMapData } from '../engine/types';
import { idx } from '../engine/grid';

export interface TinyScenarioOptions {
  seed: number;
  robots: number; // 0..4
  packages: number; // 0..24
}

const W = 14;
const H = 10;
const RUN_XS = [4, 8, 11];
const RUN_Y0 = 2; // leave rows 1 and 8 as horizontal cross-aisles
const RUN_Y1 = 7;
const DOCK_CELLS: [number, number][] = [
  [1, 3],
  [1, 4],
  [1, 5],
  [1, 6],
];
const ROBOT_HOMES: [number, number][] = [
  [2, 1],
  [2, 8],
  [12, 1],
  [12, 8],
];

export function buildTinyScenario(opts: TinyScenarioOptions): Scenario {
  const rnd = mulberry32(opts.seed);
  const cells = new Uint8Array(W * H).fill(CellType.Floor);
  for (let x = 0; x < W; x++) {
    cells[idx({ width: W }, x, 0)] = CellType.Wall;
    cells[idx({ width: W }, x, H - 1)] = CellType.Wall;
  }
  for (let y = 0; y < H; y++) {
    cells[idx({ width: W }, 0, y)] = CellType.Wall;
    cells[idx({ width: W }, W - 1, y)] = CellType.Wall;
  }
  for (const [dx, dy] of DOCK_CELLS) cells[idx({ width: W }, dx, dy)] = CellType.Dock;
  const shelfRuns: ShelfRun[] = [];
  RUN_XS.forEach((rx, ri) => {
    for (let y = RUN_Y0; y <= RUN_Y1; y++) cells[idx({ width: W }, rx, y)] = CellType.Rack;
    shelfRuns.push({
      id: `S-${ri + 1}`,
      label: `Shelf ${ri + 1}-1`,
      x: rx,
      y: RUN_Y0,
      w: 1,
      h: RUN_Y1 - RUN_Y0 + 1,
      orient: 'v',
      style: ri % 3,
    });
  });

  const map: WarehouseMapData = {
    id: 'tiny',
    name: 'Tiny Test Warehouse',
    subtitle: 'Engine test fixture',
    width: W,
    height: H,
    revision: 1,
    cells,
    zones: [
      { id: 'z-dock', name: 'Dock', kind: 'shipping', x: 0, y: 2, w: 3, h: 6 },
    ],
    shelfRuns,
    trucks: [],
    chargeCells: [],
  };

  // Packages: fill rack cells column by column, top to bottom.
  const storageCells: number[] = [];
  for (const rx of RUN_XS) for (let y = RUN_Y0; y <= RUN_Y1; y++) storageCells.push(idx({ width: W }, rx, y));
  const shapes: PackageShape[] = ['carton', 'pallet', 'beam', 'coil', 'crate', 'bag'];
  const packages: PackageData[] = [];
  const count = Math.min(opts.packages, storageCells.length);
  for (let i = 0; i < count; i++) {
    const cell = storageCells[i];
    const runIndex = Math.floor(i / (RUN_Y1 - RUN_Y0 + 1));
    const pickupX = RUN_XS[runIndex] - 1; // aisle on the left; walkable by construction
    const pickupCell = idx({ width: W }, pickupX, Math.floor(cell / W));
    packages.push({
      id: `P-${String(i + 1).padStart(2, '0')}`,
      shape: shapes[Math.floor(rnd() * shapes.length)],
      cell,
      pickupCell,
      shelfLabel: shelfRuns[runIndex].label,
      aisleLabel: `Aisle ${String.fromCharCode(65 + pickupX)}${Math.floor(cell / W) + 1}`,
      state: 'unassigned',
      seed: Math.floor(rnd() * 100000),
    });
  }

  const types: ('S1' | 'H10')[] = ['S1', 'H10', 'S1', 'H10'];
  const capacities = { S1: 1, H10: 10 } as const;
  const robots: RobotData[] = [];
  for (let i = 0; i < Math.min(opts.robots, ROBOT_HOMES.length); i++) {
    const t = types[i];
    robots.push({
      id: `R-${String(i + 1).padStart(2, '0')}`,
      type: t,
      capacity: capacities[t],
      homeCell: idx({ width: W }, ROBOT_HOMES[i][0], ROBOT_HOMES[i][1]),
    });
  }

  return {
    schemaVersion: 1,
    id: `tiny-${opts.seed}`,
    map,
    packages,
    robots,
  };
}
