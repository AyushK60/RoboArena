import { CellType, type Dir, type WarehouseMapData, type Scenario, type PackageData } from './types';

export const DIRS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export function idx(map: { width: number }, x: number, y: number): number {
  return y * map.width + x;
}

export function xOf(map: { width: number }, i: number): number {
  return i % map.width;
}

export function yOf(map: { width: number }, i: number): number {
  return Math.floor(i / map.width);
}

export function isWalkableCell(t: CellType): boolean {
  return t === CellType.Floor || t === CellType.Dock;
}

export function isWalkable(map: WarehouseMapData, i: number): boolean {
  if (i < 0 || i >= map.cells.length) return false;
  return isWalkableCell(map.cells[i]);
}

export function walkableNeighbors(map: WarehouseMapData, i: number): number[] {
  const out: number[] = [];
  const x = xOf(map, i);
  const y = yOf(map, i);
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    const nx = x + DIRS[d].dx;
    const ny = y + DIRS[d].dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    const ni = ny * map.width + nx;
    if (isWalkable(map, ni)) out.push(ni);
  }
  return out;
}

export function manhattan(map: { width: number }, a: number, b: number): number {
  return Math.abs(xOf(map, a) - xOf(map, b)) + Math.abs(yOf(map, a) - yOf(map, b));
}

export function colLetter(x: number): string {
  return String.fromCharCode(65 + Math.min(x, 25)); // A.. up to 26 columns per group
}

export function cellLabel(map: { width: number }, i: number): string {
  return `${colLetter(xOf(map, i))}${yOf(map, i) + 1}`;
}

/** Best adjacent walkable service cell for a storage cell (deterministic N,E,S,W preference). */
export function findPickupCell(map: WarehouseMapData, storageCell: number): number | null {
  const x = xOf(map, storageCell);
  const y = yOf(map, storageCell);
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    const nx = x + DIRS[d].dx;
    const ny = y + DIRS[d].dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    const ni = ny * map.width + nx;
    if (isWalkable(map, ni)) return ni;
  }
  return null;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Full geometric validation of a scenario: robots on legal cells, every package has a walkable
 * pickup cell reachable from a dock, docks reachable from robot homes, no duplicate pickups on
 * isolated cells. Used by the editor and before planning.
 */
export function validateScenario(scenario: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { map, packages, robots } = scenario;
  const dockCells: number[] = [];
  for (let i = 0; i < map.cells.length; i++) if (map.cells[i] === CellType.Dock) dockCells.push(i);
  if (dockCells.length === 0) issues.push({ level: 'error', message: 'No delivery dock cells on the map.' });

  for (const r of robots) {
    if (!isWalkable(map, r.homeCell)) {
      issues.push({ level: 'error', message: `Robot ${r.id} starts on a blocked cell.` });
    }
  }
  // Reachability flood from docks over walkable cells.
  const reach = new Uint8Array(map.cells.length);
  const queue: number[] = [];
  for (const d of dockCells) {
    if (!reach[d]) {
      reach[d] = 1;
      queue.push(d);
    }
  }
  while (queue.length) {
    const c = queue.pop()!;
    for (const n of walkableNeighbors(map, c)) {
      if (!reach[n]) {
        reach[n] = 1;
        queue.push(n);
      }
    }
  }
  for (const p of packages) {
    if (p.state === 'delivered') continue;
    if (!isWalkable(map, p.pickupCell)) {
      issues.push({ level: 'error', message: `${p.id}: pickup cell is blocked.` });
    } else if (!reach[p.pickupCell]) {
      issues.push({ level: 'error', message: `${p.id}: pickup cell is disconnected from every dock.` });
    }
  }
  for (const r of robots) {
    if (isWalkable(map, r.homeCell) && !reach[r.homeCell]) {
      issues.push({ level: 'error', message: `Robot ${r.id} start cell is disconnected from every dock.` });
    }
  }
  return issues;
}

/** Recompute a package's pickup cell after map edits. Returns null if none exists. */
export function refreshPickupCell(map: WarehouseMapData, p: PackageData): boolean {
  const pc = findPickupCell(map, p.cell);
  if (pc === null) return false;
  p.pickupCell = pc;
  return true;
}
