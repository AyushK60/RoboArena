// Pathfinding: static A* (unit-cost 4-directional) + BFS distance index used by the allocator.
import { DIRS, isWalkable, manhattan, walkableNeighbors, xOf, yOf } from './grid';
import type { Dir, WarehouseMapData } from './types';

export const INF = 0x3fffffff;

/** Binary min-heap keyed by numeric priority. Deterministic: ties broken by insertion order. */
export class MinHeap {
  private prio: number[] = [];
  private data: number[] = [];
  private size = 0;

  push(value: number, priority: number): void {
    this.prio.push(priority);
    this.data.push(value);
    this.size++;
    let i = this.size - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p] <= this.prio[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.size === 0) return undefined;
    const top = this.data[0];
    this.size--;
    if (this.size > 0) {
      this.prio[0] = this.prio[this.size];
      this.data[0] = this.data[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.prio[l] < this.prio[m]) m = l;
        if (r < this.size && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    this.prio.length = this.size;
    this.data.length = this.size;
    return top;
  }

  private swap(a: number, b: number): void {
    const tp = this.prio[a];
    this.prio[a] = this.prio[b];
    this.prio[b] = tp;
    const td = this.data[a];
    this.data[a] = this.data[b];
    this.data[b] = td;
  }

  get length(): number {
    return this.size;
  }
}

export interface AStarResult {
  path: number[] | null; // inclusive of start and goal; null when unreachable
  expanded: number;
}

/**
 * Static A* on the walkable grid with Manhattan heuristic (admissible for unit-cost 4-moves).
 * Deterministic neighbor order (N,E,S,W) and FIFO tie-breaking via insertion counter.
 */
export function astar(
  map: WarehouseMapData,
  start: number,
  goal: number,
  maxExpansions = 100000,
): AStarResult {
  if (start === goal) return { path: [start], expanded: 0 };
  if (!isWalkable(map, start) || !isWalkable(map, goal)) return { path: null, expanded: 0 };
  const n = map.cells.length;
  const g = new Int32Array(n).fill(INF);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const gScore = new Int32Array(n).fill(INF); // mirrors g for heap decrease checks
  g[start] = 0;
  gScore[start] = 0;
  let counter = 0;
  heap.push(start << 12 | counter, manhattan(map, start, goal));
  let expanded = 0;
  while (heap.length > 0 && expanded < maxExpansions) {
    const raw = heap.pop()!;
    const current = raw >>> 12;
    if (closed[current]) continue;
    closed[current] = 1;
    expanded++;
    if (current === goal) {
      const path: number[] = [goal];
      let c = goal;
      while (cameFrom[c] !== -1) {
        c = cameFrom[c];
        path.push(c);
      }
      path.reverse();
      return { path, expanded };
    }
    const cx = xOf(map, current);
    const cy = yOf(map, current);
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nx = cx + DIRS[d].dx;
      const ny = cy + DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (closed[ni] || !isWalkable(map, ni)) continue;
      const ng = g[current] + 1;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        g[ni] = ng;
        cameFrom[ni] = current;
        heap.push(ni << 12 | ++counter, ng + manhattan(map, ni, goal));
      }
    }
  }
  return { path: null, expanded };
}

/**
 * BFS distance field from one source over walkable cells. Uniform cost ⇒ BFS = A* distances.
 * Returns Int32Array with INF for unreachable/blocked cells.
 */
export function bfsDistanceField(map: WarehouseMapData, source: number): Int32Array {
  const n = map.cells.length;
  const dist = new Int32Array(n).fill(INF);
  if (!isWalkable(map, source)) return dist;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  dist[source] = 0;
  queue[tail++] = source;
  while (head < tail) {
    const c = queue[head++];
    const d = dist[c] + 1;
    const cx = xOf(map, c);
    const cy = yOf(map, c);
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS[k].dx;
      const ny = cy + DIRS[k].dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (dist[ni] === INF && isWalkable(map, ni)) {
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
  }
  return dist;
}

/**
 * Cached pairwise distances among "interesting" cells (pickups, docks, robot cells) per map
 * revision. dist(a,b) = field[a][b]. Invalidate by constructing a new index when map.revision
 * changes.
 */
export class DistanceIndex {
  readonly revision: number;
  private fields = new Map<number, Int32Array>();

  constructor(private map: WarehouseMapData) {
    this.revision = map.revision;
  }

  /** Ensure BFS fields exist for the given source cells. */
  ensure(sources: number[]): void {
    for (const s of sources) {
      if (!this.fields.has(s) && isWalkable(this.map, s)) {
        this.fields.set(s, bfsDistanceField(this.map, s));
      }
    }
  }

  /** Precompute fields for all pickup cells, dock cells, and robot cells of a scenario. */
  ensureScenario(pickups: number[], docks: number[], robotCells: number[]): void {
    this.ensure([...pickups, ...docks, ...robotCells]);
  }

  dist(from: number, to: number): number {
    const f = this.fields.get(from);
    if (!f) return INF;
    return f[to];
  }
}
