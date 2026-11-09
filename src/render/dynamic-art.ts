// Dynamic art: robot sprites, package markers, route overlays. Rebuilt/updated per frame or
// per plan change - kept separate from the cached static layer.
import { Container, Graphics, Text } from 'pixi.js';
import { MAP, FONT } from './palette';
import { drawStorageItem } from './static-art';
import type { RobotView, PathStep } from '../engine/types';
import { CELL_PX } from '../engine/constants';
import { xOf, yOf } from '../engine/grid';

// Color identity by CLASS: S1 = cyan/teal family, H10 = amber family. Per-robot variation
// comes from shade shifts within the family, plus ID badges - not ten unrelated rainbow colors.
export function robotColor(id: string, type?: 'S1' | 'H10'): number {
  const n = Math.max(0, (parseInt(id.replace(/\D/g, ''), 10) || 1) - 1);
  const family = (type ?? detectType(id)) === 'H10' ? MAP.h10Family : MAP.s1Family;
  return family[n % family.length];
}
const TYPE_MEMORY: Record<string, 'S1' | 'H10'> = {};
export function rememberRobotType(id: string, type: 'S1' | 'H10'): void {
  TYPE_MEMORY[id] = type;
}
function detectType(id: string): 'S1' | 'H10' {
  return TYPE_MEMORY[id] ?? 'S1';
}

/** Build a robot container: shadow + chassis + wheels + lights + cargo + ID badge. */
export function buildRobotSprite(view: RobotView): Container {
  const c = new Container();
  const isH10 = view.type === 'H10';
  const accent = robotColor(view.id);

  const shadow = new Graphics();
  shadow.ellipse(2, 3, isH10 ? 18 : 13, isH10 ? 15 : 11).fill({ color: MAP.robotShadow, alpha: MAP.robotShadowAlpha });
  c.addChild(shadow);

  const body = new Container();
  body.label = 'body';
  const g = new Graphics();
  const w = isH10 ? 32 : 23; // chassis width (x)
  const h = isH10 ? 27 : 19; // chassis length (y) - faces up (dir 0) by default

  // wheels: dark tires with lighter hubs, 3 per side for H10, 2 for S1
  const wheelCount = isH10 ? 3 : 2;
  for (let i = 0; i < wheelCount; i++) {
    const wy = -h / 2 + 4 + (i * (h - 8)) / Math.max(1, wheelCount - 1);
    for (const wx of [-w / 2 - 2.5, w / 2 - 1.5]) {
      g.roundRect(wx, wy - 3.5, 5, 8, 2).fill({ color: MAP.robotWheel });
      g.roundRect(wx + 1, wy - 2, 3, 5, 1.2).fill({ color: MAP.robotHub });
    }
  }
  // chassis base plate (two-tone: darker skirt + lighter deck)
  g.roundRect(-w / 2, -h / 2, w, h, isH10 ? 3.5 : 4.5).fill({ color: MAP.robotBase });
  g.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, isH10 ? 2.5 : 3.5).fill({ color: isH10 ? MAP.robotChassisH10 : MAP.robotChassisS1 });
  g.roundRect(-w / 2, -h / 2, w, h, isH10 ? 3.5 : 4.5).stroke({ width: 1.25, color: accent, alpha: 0.95 });
  // deck panel
  g.roundRect(-w / 2 + 3, -h / 2 + 4, w - 6, h - 8, 2).fill({ color: MAP.robotPlate, alpha: 0.75 });
  // deck vents
  for (let i = 0; i < (isH10 ? 3 : 2); i++) {
    g.rect(-w / 2 + 5, -1 + i * 3, w - 10, 1).fill({ color: MAP.robotVent, alpha: 0.85 });
  }
  if (isH10) {
    // cargo platform deck at rear with corner posts
    g.roundRect(-w / 2 + 2.5, -h / 2 + 5.5, w - 5, h - 10, 1.5).stroke({ width: 1, color: MAP.robotPost, alpha: 0.55 });
    for (const [px, py] of [[-w / 2 + 3.5, -h / 2 + 6.5], [w / 2 - 3.5, -h / 2 + 6.5], [-w / 2 + 3.5, h / 2 - 5.5], [w / 2 - 3.5, h / 2 - 5.5]]) {
      g.circle(px, py, 1.4).fill({ color: MAP.robotPost, alpha: 0.8 });
    }
    // rear hazard stripes
    for (let i = 0; i < 4; i++) {
      g.rect(-w / 2 + 4 + i * 6.5, h / 2 - 3.5, 3, 2).fill({ color: i % 2 === 0 ? MAP.stripeA : MAP.robotVent, alpha: 0.9 });
    }
  }
  // front LED bar + chevron (front = -y)
  g.roundRect(-w / 2 + 3, -h / 2 + 1, w - 6, 2.5, 1).fill({ color: accent, alpha: 0.98 });
  g.moveTo(0, -h / 2 + 5).lineTo(-4, -h / 2 + 9.5).moveTo(0, -h / 2 + 5).lineTo(4, -h / 2 + 9.5).stroke({ width: 1.5, color: MAP.robotChevron, alpha: 0.85 });
  // lidar puck (center front)
  g.circle(0, -h / 2 + 7, isH10 ? 2.6 : 2).fill({ color: MAP.robotLidar });
  g.circle(0, -h / 2 + 7, isH10 ? 1.6 : 1.2).fill({ color: accent, alpha: 0.9 });
  // status LEDs rear
  g.circle(-w / 2 + 4, h / 2 - 3, 1.1).fill({ color: 0x34d399, alpha: 0.9 });
  g.circle(w / 2 - 4, h / 2 - 3, 1.1).fill({ color: 0xf87171, alpha: 0.9 });
  body.addChild(g);
  c.addChild(body);

  // cargo stack - added by updateRobotCargo
  const cargoHolder = new Container();
  cargoHolder.label = 'cargo';
  c.addChild(cargoHolder);

  // status ring (pickup progress / waiting pulse) - hidden by default
  const ring = new Graphics();
  ring.label = 'ring';
  c.addChild(ring);

  // ID badge below
  const badge = new Graphics();
  const bw = isH10 ? 32 : 26;
  badge.roundRect(-bw / 2, h / 2 + 3, bw, 11, 3).fill({ color: MAP.badgeBg, alpha: 0.94 });
  badge.roundRect(-bw / 2, h / 2 + 3, bw, 11, 3).stroke({ width: 1, color: accent, alpha: 0.85 });
  const t = new Text({
    text: view.id,
    style: { fontFamily: FONT.mono, fontSize: 8, fontWeight: '600', fill: MAP.badgeText, letterSpacing: 0.3 },
  });
  t.x = -t.width / 2;
  t.y = h / 2 + 5;
  badge.addChild(t);
  c.addChild(badge);

  return c;
}

export function updateRobotCargo(sprite: Container, view: RobotView): void {
  const cargoHolder = sprite.getChildByName('cargo');
  if (!cargoHolder) return;
  cargoHolder.removeChildren();
  if (view.cargo.length === 0) return;
  const isH10 = view.type === 'H10';
  const g = new Graphics();
  const shown = Math.min(view.cargo.length, isH10 ? 4 : 1);
  for (let i = 0; i < shown; i++) {
    const s = 7 - i * 0.6;
    const yy = isH10 ? -2 - i * 5 : -8;
    g.roundRect(-s / 2, yy - s / 2, s, s, 1).fill({ color: 0xc9975c });
    g.roundRect(-s / 2, yy - s / 2, s, s, 1).stroke({ width: 0.75, color: 0x6e5533, alpha: 0.9 });
  }
  cargoHolder.addChild(g);
  if (view.cargo.length > 1) {
    const t = new Text({
      text: String(view.cargo.length),
      style: { fontFamily: FONT.mono, fontSize: 7, fontWeight: '600', fill: MAP.badgeBg },
    });
    const pill = new Graphics();
    pill.circle(10, -10, 5.5).fill({ color: MAP.badgeText, alpha: 0.95 });
    t.x = 10 - t.width / 2;
    t.y = -10 - 4;
    pill.addChild(t);
    cargoHolder.addChild(pill);
  }
}

export function updateRobotRing(sprite: Container, view: RobotView, tickFloat: number): void {
  const ring = sprite.getChildByName('ring') as Graphics | undefined;
  if (!ring) return;
  ring.clear();
  const isH10 = view.type === 'H10';
  const r = isH10 ? 23 : 17;
  if (view.state === 'pickingUp' || view.state === 'unloading') {
    const frac = view.dwellTotal;
    ring.circle(0, 0, r).stroke({ width: 1.5, color: MAP.ringTrack, alpha: 0.6 });
    if (frac > 0) {
      const a0 = -Math.PI / 2;
      const a1 = a0 + frac * Math.PI * 2;
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + ((a1 - a0) * i) / steps;
        const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
        ring.moveTo(Math.cos(t0) * r, Math.sin(t0) * r).lineTo(Math.cos(t1) * r, Math.sin(t1) * r).stroke({ width: 2.5, color: view.state === 'unloading' ? MAP.ok : MAP.pickRing, alpha: 0.95 });
      }
    }
  } else if (view.state === 'waiting') {
    const pulse = 0.5 + 0.5 * Math.sin(tickFloat * 4);
    ring.circle(0, 0, r).stroke({ width: 1.5, color: MAP.waitRing, alpha: 0.25 + pulse * 0.5 });
  }
}

export interface PackageMarkerInfo {
  id: string;
  shape: string;
  seed: number;
  cell: number;
  mapW: number;
  state: string;
}

/** Package = the actual inventory object drawn in its slot; the slot around it reads empty. */
export function buildPackageMarker(info: PackageMarkerInfo, selected: boolean): Container {
  const c = new Container();
  const px = xOf({ width: info.mapW }, info.cell) * CELL_PX;
  const py = yOf({ width: info.mapW }, info.cell) * CELL_PX;
  c.position.set(px, py);
  c.label = 'pkg';
  const g = new Graphics();
  const col = MAP.pkgAccent;
  // the item itself, filling the slot
  const art = new Graphics();
  drawStorageItem(art, info.shape, 2.5, 2.5, CELL_PX - 5, CELL_PX - 5, info.seed, MAP.cartonFills[info.seed % MAP.cartonFills.length]);
  c.addChild(art);
  if (selected) {
    g.roundRect(0.5, 0.5, CELL_PX - 1, CELL_PX - 1, 3).stroke({ width: 2, color: col, alpha: 0.95 });
    g.roundRect(0.5, 0.5, CELL_PX - 1, CELL_PX - 1, 3).fill({ color: col, alpha: 0.10 });
    c.addChildAt(g, 0);
    const chip = new Graphics();
    chip.roundRect(CELL_PX / 2 - 9, CELL_PX - 6, 18, 11, 2.5).fill({ color: MAP.badgeBg, alpha: 0.95 });
    chip.roundRect(CELL_PX / 2 - 9, CELL_PX - 6, 18, 11, 2.5).stroke({ width: 1, color: col, alpha: 0.9 });
    const t = new Text({
      text: info.id.replace('P-', ''),
      style: { fontFamily: FONT.mono, fontSize: 8, fontWeight: '600', fill: col },
    });
    t.x = CELL_PX / 2 - t.width / 2;
    t.y = CELL_PX - 4.5;
    chip.addChild(t);
    c.addChild(chip);
  } else {
    // subtle corner pip so every item is findable without shouting
    const pip = new Graphics();
    pip.moveTo(CELL_PX - 7, 1).lineTo(CELL_PX - 1, 1).lineTo(CELL_PX - 1, CELL_PX - 7).closePath().fill({ color: MAP.badgeBg, alpha: 0.88 });
    c.addChild(pip);
  }
  return c;
}

/** Dashed polyline with arrowheads for a robot's planned route. */
export function drawRoute(g: Graphics, steps: PathStep[], mapW: number, color: number, startTick: number, currentTick: number): void {
  if (steps.length === 0) return;
  const pts: { x: number; y: number }[] = [];
  for (const s of steps) {
    const x = xOf({ width: mapW }, s.cell) * CELL_PX + CELL_PX / 2;
    const y = yOf({ width: mapW }, s.cell) * CELL_PX + CELL_PX / 2;
    const last = pts[pts.length - 1];
    if (!last || last.x !== x || last.y !== y) pts.push({ x, y });
  }
  if (pts.length < 2) return;
  // dashed segments
  const dash = 5;
  const gap = 4;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    let d = 0;
    while (d < len) {
      const d2 = Math.min(d + dash, len);
      // fade the part already executed
      g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * d2, a.y + uy * d2).stroke({ width: 2, color, alpha: 0.85 });
      d = d2 + gap;
    }
  }
  // arrowheads every ~2.5 cells along the polyline
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 24; d < len; d += 64) {
      const ax = a.x + ux * d;
      const ay = a.y + uy * d;
      const px = -uy;
      const py = ux;
      g.moveTo(ax - ux * 4, ay - uy * 4).lineTo(ax + px * 3, ay + py * 3).lineTo(ax - px * 3, ay - py * 3).closePath().fill({ color, alpha: 0.8 });
    }
  }
}
