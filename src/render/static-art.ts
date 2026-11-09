// Static warehouse art: floor, zones, markings and rack/shelf blocks, drawn once per map
// revision into a cached RenderTexture. All procedural vector art.
import { Container, Graphics, RenderTexture, Text } from 'pixi.js';
import { MAP, FONT } from './palette';
import { mulberry32 } from '../engine/rng';
import { CellType, type PackageData, type WarehouseMapData } from '../engine/types';
import { xOf, yOf } from '../engine/grid';
import { CELL_PX } from '../engine/constants';

type G = Graphics;

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function drawCarton(g: G, x: number, y: number, w: number, h: number, fill: number, seed: number): void {
  const rnd = mulberry32(seed);
  g.rect(x, y, w, h).fill({ color: fill });
  // top-lit highlight + bottom shade
  g.rect(x, y, w, 1).fill({ color: shade(fill, 1.25), alpha: 0.8 });
  g.rect(x, y + h - 1, w, 1).fill({ color: shade(fill, 0.72), alpha: 0.9 });
  // tape seam
  if (w >= 8 && rnd() > 0.35) {
    g.rect(x + Math.floor(w / 2), y + 1, 1, h - 2).fill({ color: MAP.tape, alpha: 0.55 });
  }
  // label sticker
  if (rnd() > 0.6) {
    g.rect(x + 1 + Math.floor(rnd() * (w - 4)), y + 1 + Math.floor(rnd() * Math.max(1, h - 4)), 2, 2).fill({ color: 0xe8e4d8, alpha: 0.75 });
  }
  g.rect(x, y, w, h).stroke({ width: 0.5, color: shade(fill, 0.55), alpha: 0.8 });
}

function drawPallet(g: G, x: number, y: number, w: number, h: number, seed: number): void {
  const wood = 0x9a7a4e;
  const dark = 0x6e5533;
  g.rect(x, y + h - 4, w, 2).fill({ color: dark });
  g.rect(x + 1, y + h - 2, w - 2, 1).fill({ color: shade(dark, 0.7) });
  g.rect(x, y, w, h - 4).fill({ color: wood });
  g.rect(x, y, w, 1).fill({ color: shade(wood, 1.2), alpha: 0.8 });
  for (let i = 1; i < 3; i++) g.rect(x, y + ((h - 4) * i) / 3, w, 1).fill({ color: dark, alpha: 0.5 });
  if (seed % 3 === 0) {
    g.rect(x + 2, y + 2, w - 4, h - 8).fill({ color: 0xb99873, alpha: 0.5 });
  }
  g.rect(x, y, w, h).stroke({ width: 0.5, color: shade(wood, 0.5), alpha: 0.8 });
}

function drawBeam(g: G, x: number, y: number, w: number, h: number): void {
  const steel = 0x8398b8;
  g.rect(x, y, w, h).fill({ color: steel });
  g.rect(x, y, w, 1).fill({ color: shade(steel, 1.25), alpha: 0.9 });
  g.rect(x, y + h - 2, w, 2).fill({ color: shade(steel, 0.65) });
  g.rect(x + Math.floor(w / 2), y + 1, 1, h - 3).fill({ color: shade(steel, 0.8), alpha: 0.7 });
  g.rect(x, y, w, h).stroke({ width: 0.5, color: MAP.itemOutline, alpha: 0.9 });
}

function drawCoil(g: G, cx: number, cy: number, r: number, seed: number): void {
  const steel = seed % 2 === 0 ? 0x93a3bd : 0xb08d55;
  g.circle(cx, cy, r).fill({ color: steel });
  g.circle(cx, cy, r - 2).fill({ color: shade(steel, 0.75) });
  g.circle(cx, cy, r - 4).fill({ color: shade(steel, 1.1) });
  g.circle(cx, cy, r - 6).fill({ color: shade(steel, 0.6) });
  g.circle(cx, cy, r).stroke({ width: 0.5, color: MAP.itemOutline, alpha: 0.9 });
}

function drawCrate(g: G, x: number, y: number, w: number, h: number, seed: number): void {
  const c = 0x8aa0bf;
  g.rect(x, y, w, h).fill({ color: c });
  g.rect(x, y, w, 2).fill({ color: shade(c, 1.2), alpha: 0.9 });
  g.rect(x, y + h - 2, w, 2).fill({ color: shade(c, 0.7) });
  g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke({ width: 0.75, color: shade(c, 0.6), alpha: 0.7 });
  g.rect(x, y, w, h).stroke({ width: 0.5, color: shade(c, 0.45) });
}

function drawBag(g: G, x: number, y: number, w: number, h: number, seed: number): void {
  const c = seed % 2 === 0 ? 0xd8d0bd : 0x9fb0c8;
  g.roundRect(x + 1, y, w - 2, h, 3).fill({ color: c });
  g.rect(x + 3, y - 1, w - 6, 2).fill({ color: shade(c, 0.7) });
  g.roundRect(x + 1, y, w - 2, h, 3).stroke({ width: 0.5, color: shade(c, 0.55) });
}

export function drawStorageItem(
  g: G,
  shape: string,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  fill: number,
): void {
  switch (shape) {
    case 'pallet': drawPallet(g, x, y, w, h, seed); break;
    case 'beam': drawBeam(g, x, y + 2, w, h - 4); break;
    case 'coil': drawCoil(g, x + w / 2, y + h / 2, Math.min(w, h) / 2 - 1, seed); break;
    case 'crate': drawCrate(g, x, y, w, h, seed); break;
    case 'bag': drawBag(g, x, y, w, h, seed); break;
    default: drawCarton(g, x, y, w, h, fill, seed);
  }
}

/**
 * Draw one shelf cell as a structured EMPTY storage slot. Packages render dynamically on top,
 * so an occupied slot (cartons visible) is unmistakably different from an empty one.
 */
function drawShelfCell(g: G, map: WarehouseMapData, cell: number, seed: number, bulk: boolean): void {
  const px = xOf(map, cell) * CELL_PX;
  const py = yOf(map, cell) * CELL_PX;
  const rnd = mulberry32(seed);
  // interior: darker cavity with two shelf rails
  g.rect(px + 0.5, py + 0.5, CELL_PX - 1, CELL_PX - 1).fill({ color: MAP.cavity1 });
  g.rect(px + 1.5, py + 1.5, CELL_PX - 3, CELL_PX - 3).fill({ color: MAP.cavity2 });
  // horizontal rails (front + back) - steel
  g.rect(px + 1, py + 2, CELL_PX - 2, 2.5).fill({ color: MAP.rackFrame, alpha: 0.75 });
  g.rect(px + 1, py + CELL_PX - 5, CELL_PX - 2, 2.5).fill({ color: MAP.rackFrame, alpha: 0.6 });
  // vertical divider hints
  g.moveTo(px + CELL_PX / 2, py + 4).lineTo(px + CELL_PX / 2, py + CELL_PX - 4).stroke({ width: 0.75, color: MAP.divider, alpha: 0.9 });
  // slot floor sheen
  g.rect(px + 3, py + 6, CELL_PX - 6, 4).fill({ color: MAP.sheen, alpha: 0.8 });
  if (bulk) {
    // bulk background stock: muted, uniform cartons - clearly not mission inventory
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        if (rnd() > 0.9) continue;
        const cw = 12 + Math.floor(rnd() * 2);
        const ch = 11 + Math.floor(rnd() * 2);
        const cx = px + 3.5 + i * 14;
        const cy = py + 4 + j * 13;
        g.rect(cx, cy, cw, ch).fill({ color: 0x6e6455, alpha: 0.9 });
        g.rect(cx, cy, cw, 1).fill({ color: 0x837763, alpha: 0.8 });
        g.rect(cx, cy + ch - 1, cw, 1).fill({ color: 0x514940, alpha: 0.9 });
      }
    }
  } else if (rnd() > 0.75) {
    // occasional debris / strap on the empty slot floor
    g.rect(px + 6 + rnd() * 10, py + 12 + rnd() * 8, 4, 1.5).fill({ color: MAP.debris, alpha: 0.9 });
  }
  // frame
  g.rect(px + 0.5, py + 0.5, CELL_PX - 1, CELL_PX - 1).stroke({ width: 1.5, color: MAP.rackFrameDark, alpha: 0.9 });
  g.rect(px + 1.5, py + 1.5, CELL_PX - 3, CELL_PX - 3).stroke({ width: 0.75, color: MAP.rackFrame, alpha: 0.55 });
}

export interface StaticArtResult {
  texture: RenderTexture;
}

/**
 * Render floor + racks + static shelf inventory into a cached texture (world-size, 2x res).
 */
export interface PresetStyle {
  floor: number; // base floor tint
  rackFrame: number; // steel frame tint
  accentMark: number; // lane arrow tint
}

export const PRESET_STYLES: Record<string, PresetStyle> = {
  ecommerce: { floor: 0x15253b, rackFrame: 0x7f95b6, accentMark: 0xe4dcc6 },
  steel: { floor: 0x132336, rackFrame: 0x8aa0c0, accentMark: 0xdde4ee },
  construction: { floor: 0x1a2536, rackFrame: 0xa59f8a, accentMark: 0xe8e2d2 },
  crossdock: { floor: 0x122238, rackFrame: 0x7790b3, accentMark: 0xd6e0ee },
};

export function buildStaticArt(
  renderer: { render(options: { container: Container; target: RenderTexture; clear?: boolean }): void },
  map: WarehouseMapData,
  packages: PackageData[],
): RenderTexture {
  const style = PRESET_STYLES[map.id] ?? PRESET_STYLES.ecommerce;
  const floorColor = MAP.floorByPreset[map.id] ?? MAP.floorBase;
  const w = map.width * CELL_PX;
  const h = map.height * CELL_PX;
  const c = new Container();
  const rnd = mulberry32(1234567 + map.width * 31 + map.height * 7);

  // ---------- floor ----------
  const floor = new Graphics();
  floor.rect(0, 0, w, h).fill({ color: floorColor });
  // per-tile variation + seams
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const v = rnd();
      if (v > 0.82) {
        floor
          .rect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX)
          .fill({ color: MAP.floorTile, alpha: 0.35 + v * 0.3 });
      }
    }
  }
  for (let x = 0; x <= map.width; x++) {
    floor.moveTo(x * CELL_PX + 0.5, 0).lineTo(x * CELL_PX + 0.5, h).stroke({ width: 1, color: MAP.floorSeam, alpha: x % 5 === 0 ? 0.5 : 0.3 });
  }
  for (let y = 0; y <= map.height; y++) {
    floor.moveTo(0, y * CELL_PX + 0.5).lineTo(w, y * CELL_PX + 0.5).stroke({ width: 1, color: MAP.floorSeam, alpha: y % 5 === 0 ? 0.5 : 0.3 });
  }
  // scuffs and wear streaks
  for (let i = 0; i < map.width + map.height; i++) {
    const sx = rnd() * w;
    const sy = rnd() * h;
    const len = 8 + rnd() * 30;
    const ang = rnd() * Math.PI;
    floor
      .moveTo(sx, sy)
      .lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len)
      .stroke({ width: 1 + rnd() * 2, color: MAP.floorScuff, alpha: 0.3 });
  }
  c.addChild(floor);

  // ---------- zones ----------
  const zonesG = new Graphics();
  for (const z of map.zones) {
    const zx = z.x * CELL_PX;
    const zy = z.y * CELL_PX;
    const zw = z.w * CELL_PX;
    const zh = z.h * CELL_PX;
    const tint = MAP.zoneTints[z.kind] ?? MAP.zoneTints.storage;
    if (z.kind === 'restricted') {
      zonesG.rect(zx, zy, zw, zh).fill({ color: tint, alpha: 0.10 });
      for (let d = -zh; d < zw; d += 14) {
        zonesG.moveTo(zx + d, zy + zh).lineTo(zx + d + zh, zy).stroke({ width: 2, color: tint, alpha: 0.22 });
      }
    } else {
      zonesG.rect(zx, zy, zw, zh).fill({ color: tint, alpha: 0.12 });
    }
    zonesG.rect(zx + 1, zy + 1, zw - 2, zh - 2).stroke({ width: 1.5, color: tint, alpha: 0.4 });
  }
  c.addChild(zonesG);

  // zone labels
  for (const z of map.zones) {
    if (z.w < 3 || z.h < 2) continue;
    const tint = MAP.zoneTints[z.kind] ?? MAP.zoneTints.storage;
    const label = new Text({
      text: z.name.toUpperCase(),
      style: { fontFamily: FONT.mono, fontSize: 10, fontWeight: '500', fill: tint, letterSpacing: 2.5 },
    });
    label.x = z.x * CELL_PX + 8;
    label.y = z.y * CELL_PX + 6;
    label.alpha = 0.9;
    c.addChild(label);
  }

  // ---------- floor markings ----------
  const mark = new Graphics();
  // safety lines around each shelf run (offset 3px outside the run)
  for (const run of map.shelfRuns) {
    const rx = run.x * CELL_PX;
    const ry = run.y * CELL_PX;
    const rw = run.w * CELL_PX;
    const rh = run.h * CELL_PX;
    mark.rect(rx - 4.5, ry - 4.5, rw + 9, rh + 9).stroke({ width: 1, color: MAP.safety, alpha: 0.28 });
  }
  // dashed lane arrows on the central cross-aisle (found dynamically: widest all-floor row band)
  const arrowY = centralAisleY(map);
  if (arrowY >= 0) {
    for (let x = 4; x < map.width - 4; x += 5) {
      const c0 = arrowY * map.width + x;
      if (map.cells[c0] !== CellType.Floor) continue;
      drawFloorArrow(mark, x * CELL_PX + 16, arrowY * CELL_PX + CELL_PX / 2, 1, 0.16);
    }
  }
  // dock hazard stripes at dock cell map-edges
  for (let i = 0; i < map.cells.length; i++) {
    if (map.cells[i] !== CellType.Dock) continue;
    const x = xOf(map, i);
    const y = yOf(map, i);
    const px = x * CELL_PX;
    const py = y * CELL_PX;
    if (x === 0 || map.cells[i - 1] === CellType.Wall) {
      for (let d = 0; d < CELL_PX; d += 8) {
        mark.moveTo(px + 1.5, py + d).lineTo(px + 1.5, py + d + 4).stroke({ width: 3, color: MAP.safety, alpha: 0.5 });
      }
    }
    if (x === map.width - 1 || map.cells[i + 1] === CellType.Wall) {
      for (let d = 0; d < CELL_PX; d += 8) {
        mark.moveTo(px + CELL_PX - 1.5, py + d).lineTo(px + CELL_PX - 1.5, py + d + 4).stroke({ width: 3, color: MAP.safety, alpha: 0.5 });
      }
    }
  }
  // charging pads
  for (const cc of map.chargeCells) {
    const px = xOf(map, cc) * CELL_PX;
    const py = yOf(map, cc) * CELL_PX;
    mark.roundRect(px + 4, py + 4, CELL_PX - 8, CELL_PX - 8, 4).fill({ color: MAP.zoneTints.charging, alpha: 0.2 });
    mark.roundRect(px + 4, py + 4, CELL_PX - 8, CELL_PX - 8, 4).stroke({ width: 1, color: MAP.zoneTints.charging, alpha: 0.6 });
    // bolt glyph
    mark.moveTo(px + 17, py + 9).lineTo(px + 13, py + 17).lineTo(px + 16, py + 17).lineTo(px + 14, py + 24).lineTo(px + 20, py + 15).lineTo(px + 17, py + 15).lineTo(px + 19, py + 9).closePath().fill({ color: MAP.zoneTints.charging, alpha: 0.9 });
  }
  // industrial props: dock bay numbers, walkway border, perimeter signage
  const props = new Graphics();
  let dockIdx = 0;
  for (let i = 0; i < map.cells.length; i++) {
    if (map.cells[i] !== CellType.Dock) continue;
    const x = xOf(map, i);
    const y = yOf(map, i);
    const px = x * CELL_PX;
    const py = y * CELL_PX;
    if (x <= 1 || map.cells[i - 1] === CellType.Wall) {
      dockIdx++;
      const t = new Text({
        text: String(dockIdx).padStart(2, '0'),
        style: { fontFamily: FONT.mono, fontSize: 10, fontWeight: '600', fill: MAP.safety, letterSpacing: 1 },
      });
      t.x = px + 4;
      t.y = py + CELL_PX / 2 - 6;
      t.alpha = 0.8;
      c.addChild(t);
      props.moveTo(px + CELL_PX - 2, py + 4).lineTo(px + CELL_PX - 2, py + CELL_PX - 4).stroke({ width: 2, color: MAP.safety, alpha: 0.4 });
    } else if (x >= map.width - 2 || map.cells[i + 1] === CellType.Wall) {
      props.moveTo(px + 2, py + 4).lineTo(px + 2, py + CELL_PX - 4).stroke({ width: 2, color: MAP.safety, alpha: 0.4 });
    }
  }
  // painted walkway border around charging zones
  for (const z of map.zones) {
    if (z.kind !== 'charging') continue;
    const zx = z.x * CELL_PX;
    const zy = z.y * CELL_PX;
    const zw = z.w * CELL_PX;
    const zh = z.h * CELL_PX;
    for (let d = 0; d < zw; d += 12) {
      props.rect(zx + d, zy + zh - 3, 6, 2).fill({ color: MAP.safety, alpha: 0.35 });
      props.rect(zx + d, zy + 1, 6, 2).fill({ color: MAP.safety, alpha: 0.35 });
    }
  }
  // vignette: subtle darkening toward edges for depth
  const vTop = new Graphics();
  for (let i = 0; i < 14; i++) {
    vTop.rect(0, i * 2, w, 2).fill({ color: 0x000000, alpha: 0.016 * (14 - i) * MAP.vignette });
    vTop.rect(0, h - 2 - i * 2, w, 2).fill({ color: 0x000000, alpha: 0.016 * (14 - i) * MAP.vignette });
  }
  c.addChild(mark);
  c.addChild(props);
  c.addChild(vTop);

  // ---------- column letters / row numbers ----------
  const grid = new Container();
  for (let x = 0; x < map.width; x++) {
    const t = new Text({
      text: String.fromCharCode(65 + (x % 26)) + (x >= 26 ? String.fromCharCode(65 + Math.floor(x / 26) - 1) : ''),
      style: { fontFamily: FONT.mono, fontSize: 9, fontWeight: '400', fill: MAP.gridText },
    });
    t.x = x * CELL_PX + CELL_PX / 2 - t.width / 2;
    t.y = -16;
    t.alpha = 0.55;
    grid.addChild(t);
  }
  for (let y = 0; y < map.height; y++) {
    const t = new Text({
      text: String(y + 1),
      style: { fontFamily: FONT.mono, fontSize: 9, fontWeight: '400', fill: MAP.gridText },
    });
    t.x = -14;
    t.y = y * CELL_PX + CELL_PX / 2 - 6;
    t.alpha = 0.55;
    grid.addChild(t);
  }
  c.addChild(grid);

  // ---------- racks ----------
  const racks = new Graphics();
  // shadows first
  for (const run of map.shelfRuns) {
    racks.roundRect(run.x * CELL_PX + 3, run.y * CELL_PX + 4, run.w * CELL_PX, run.h * CELL_PX, 3).fill({ color: MAP.rackShadow, alpha: MAP.rackShadowAlpha });
  }
  c.addChild(racks);
  const racksCells = new Graphics();
  const pkgCells = new Set(packages.map((p) => p.cell));
  for (const run of map.shelfRuns) {
    for (let yy = 0; yy < run.h; yy++) {
      for (let xx = 0; xx < run.w; xx++) {
        const cell = (run.y + yy) * map.width + (run.x + xx);
        const rnd = mulberry32((cell * 2246822519) >>> 13);
        const bulk = !pkgCells.has(cell) && rnd() < 0.62; // ~62% of free slots hold bulk stock
        drawShelfCell(racksCells, map, cell, (cell * 2654435761) >>> 16, bulk);
      }
    }
    // yellow feet along the block
    const rx = run.x * CELL_PX;
    const ry = run.y * CELL_PX;
    const rw = run.w * CELL_PX;
    const rh = run.h * CELL_PX;
    for (let yy = 0; yy <= run.h; yy += 2) {
      racksCells.rect(rx - 1.5, ry + yy * CELL_PX - 1.5, 4, 4).fill({ color: MAP.rackFoot, alpha: 0.95 });
      racksCells.rect(rx + rw - 2.5, ry + yy * CELL_PX - 1.5, 4, 4).fill({ color: MAP.rackFoot, alpha: 0.95 });
    }
    racksCells.rect(rx - 1.5, ry - 1.5, 4, 4).fill({ color: MAP.rackFoot });
    racksCells.rect(rx + rw - 2.5, ry - 1.5, 4, 4).fill({ color: MAP.rackFoot });
    racksCells.rect(rx - 1.5, ry + rh - 2.5, 4, 4).fill({ color: MAP.rackFoot });
    racksCells.rect(rx + rw - 2.5, ry + rh - 2.5, 4, 4).fill({ color: MAP.rackFoot });
  }
  c.addChild(racksCells);

  // ---------- trucks ----------
  const trucks = new Graphics();
  for (const t of map.trucks) {
    drawTruck(trucks, t.x * CELL_PX, t.y * CELL_PX, t.orient, t.kind);
  }
  c.addChild(trucks);

  // package shelf indicators (subtle): colored corner mark at storage cell of each package
  const pkgMark = new Graphics();
  for (const p of packages) {
    const px = xOf(map, p.cell) * CELL_PX;
    const py = yOf(map, p.cell) * CELL_PX;
    const col = p.state === 'delivered' ? MAP.zoneTints.charging : MAP.pkgAccent;
    pkgMark.rect(px + 2, py + 2, CELL_PX - 4, CELL_PX - 4).stroke({ width: 1, color: col, alpha: p.state === 'delivered' ? 0.25 : 0.55 });
  }
  c.addChild(pkgMark);

  // Render at 2x pixel density for crisp zoom-in (RT `resolution` is unreliable across
  // PixiJS 8 builds, so we scale the container instead).
  c.scale.set(2);
  const rt = RenderTexture.create({ width: w * 2, height: h * 2 });
  renderer.render({ container: c, target: rt, clear: true });
  c.destroy({ children: true });
  return rt;
}

function centralAisleY(map: WarehouseMapData): number {
  // widest horizontal band of consecutive all-floor rows near the vertical middle
  const mid = Math.floor(map.height / 2);
  for (let off = 0; off < map.height / 2; off++) {
    const y = mid + off;
    let allFloor = true;
    for (let x = 1; x < map.width - 1; x++) if (map.cells[y * map.width + x] !== CellType.Floor) { allFloor = false; break; }
    if (allFloor) return y;
  }
  return -1;
}

function drawFloorArrow(g: G, cx: number, cy: number, dir: 0 | 1 | 2 | 3, alpha: number): void {
  // chevron pointing dir (0=N)
  const s = 5;
  g.beginPath();
  if (dir === 1) {
    g.moveTo(cx - s / 2, cy - s).lineTo(cx + s / 2, cy).lineTo(cx - s / 2, cy + s);
  } else if (dir === 3) {
    g.moveTo(cx + s / 2, cy - s).lineTo(cx - s / 2, cy).lineTo(cx + s / 2, cy + s);
  } else if (dir === 2) {
    g.moveTo(cx - s, cy - s / 2).lineTo(cx, cy + s / 2).lineTo(cx + s, cy - s / 2);
  } else {
    g.moveTo(cx - s, cy + s / 2).lineTo(cx, cy - s / 2).lineTo(cx + s, cy + s / 2);
  }
  g.stroke({ width: 2.5, color: MAP.safety, alpha });
}

function drawTruck(g: G, px: number, py: number, orient: 'v' | 'h', kind: 'box' | 'flatbed'): void {
  const bodyW = orient === 'v' ? CELL_PX * 1.6 : CELL_PX * 2.6;
  const bodyH = orient === 'v' ? CELL_PX * 2.6 : CELL_PX * 1.6;
  const cabW = orient === 'v' ? bodyW : bodyW * 0.28;
  const cabH = orient === 'v' ? bodyH * 0.28 : bodyH;
  const x = px;
  const y = py;
  const cab = MAP.truckCab;
  const box = kind === 'box' ? MAP.truckBox : MAP.truckFlat;
  // shadow
  g.roundRect(x + 3, y + 4, bodyW, bodyH, 4).fill({ color: MAP.truckShadow, alpha: 0.4 });
  if (orient === 'v') {
    g.roundRect(x, y, bodyW, bodyH - cabH - 2, 3).fill({ color: box });
    g.roundRect(x, y + bodyH - cabH, cabW, cabH, 3).fill({ color: cab });
  } else {
    g.roundRect(x + cabW + 2, y, bodyW - cabW - 2, bodyH, 3).fill({ color: box });
    g.roundRect(x, y, cabW, cabH, 3).fill({ color: cab });
  }
  g.rect(x, y, bodyW, bodyH).stroke({ width: 1, color: MAP.truckStroke, alpha: 0.9 });
}
