// A* correctness: Manhattan metric, maze agreement with BFS, explicit unreachability.
import { describe, expect, it } from 'vitest';
import { astar, bfsDistanceField, INF } from '../src/engine/pathfinding';
import { CellType, type WarehouseMapData } from '../src/engine/types';

function blankMap(w: number, h: number): WarehouseMapData {
  return {
    id: 't',
    name: 't',
    subtitle: '',
    width: w,
    height: h,
    revision: 1,
    cells: new Uint8Array(w * h).fill(CellType.Floor),
    zones: [],
    shelfRuns: [],
    trucks: [],
    chargeCells: [],
  };
}

function pathLength(map: WarehouseMapData, path: number[]): number {
  return path.length - 1; // unit-cost moves
}

describe('A* static routing', () => {
  it('empty 8x8 grid: route length equals Manhattan distance', () => {
    const map = blankMap(8, 8);
    const start = 0; // (0,0)
    const goal = 8 * 5 + 7; // (7,5)
    const r = astar(map, start, goal);
    expect(r.path).not.toBeNull();
    expect(pathLength(map, r.path!)).toBe(Math.abs(7 - 0) + Math.abs(5 - 0));
  });

  it('maze: A* route length equals BFS shortest path', () => {
    const map = blankMap(10, 10);
    // Build a maze-like wall pattern.
    const walls: [number, number][] = [
      [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
      [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3],
      [5, 5], [5, 6], [5, 7], [5, 8],
      [7, 1], [7, 2], [7, 4], [7, 5], [7, 6], [7, 8],
    ];
    for (const [x, y] of walls) map.cells[y * 10 + x] = CellType.Wall;
    const start = 0;
    const goal = 9 * 10 + 9;
    const r = astar(map, start, goal);
    expect(r.path).not.toBeNull();
    const bfs = bfsDistanceField(map, start);
    const bfsLen = bfs[goal];
    expect(bfsLen).not.toBe(INF);
    expect(pathLength(map, r.path!)).toBe(bfsLen);
    // The returned path must itself be walkable and contiguous.
    const p = r.path!;
    for (const c of p) expect(map.cells[c] === CellType.Floor || map.cells[c] === CellType.Dock).toBe(true);
    for (let i = 1; i < p.length; i++) {
      const dx = Math.abs((p[i] % 10) - (p[i - 1] % 10));
      const dy = Math.abs(Math.floor(p[i] / 10) - Math.floor(p[i - 1] / 10));
      expect(dx + dy).toBe(1);
    }
  });

  it('disconnected map: unreachable is explicit, no path through walls', () => {
    const map = blankMap(6, 6);
    for (let x = 0; x < 6; x++) map.cells[2 * 6 + x] = CellType.Wall; // full horizontal wall
    const r = astar(map, 0, 5 * 6 + 5);
    expect(r.path).toBeNull();
  });

  it('goal on blocked cell returns null', () => {
    const map = blankMap(4, 4);
    map.cells[5] = CellType.Rack;
    expect(astar(map, 0, 5).path).toBeNull();
  });
});
