// PixiJS 8 warehouse stage: cached static layer + dynamic layers + camera + minimap.
// The renderer only READS engine state (simulation snapshot/plan); it holds no business rules.
import { Application, Container, Graphics, RenderTexture, Sprite, Text } from 'pixi.js';
import { CELL_PX, TICK_SECONDS } from '../engine/constants';
import { xOf, yOf } from '../engine/grid';
import type { PlanResult, Scenario, SimSnapshot } from '../engine/types';
import { buildStaticArt } from './static-art';
import {
  buildPackageMarker,
  buildRobotSprite,
  drawRoute,
  robotColor,
  rememberRobotType,
  updateRobotCargo,
  updateRobotRing,
} from './dynamic-art';
import type { PackageMarkerInfo } from './dynamic-art';
import { CSS, FONT, MAP, setCanvasTheme, type CanvasThemeName } from './palette';

export interface RendererCallbacks {
  onCellClick?: (cell: number, shift: boolean) => void;
  onCellHover?: (cell: number | null) => void;
  onEmptyClick?: () => void;
}

export class WarehouseRenderer {
  app: Application;
  private world = new Container();
  private staticSprite: Sprite | null = null;
  private pkgLayer = new Container();
  private routeLayer = new Graphics();
  private robotLayer = new Container();
  private fxLayer = new Graphics();
  private overlayLayer = new Graphics();
  private screenOverlay = new Container();
  private minimap = new Container();
  private minimapDots = new Graphics();
  private minimapView = new Graphics();
  private mapW = 0;
  private mapH = 0;
  private scenario: Scenario | null = null;
  private plan: PlanResult | null = null;
  private snapshot: SimSnapshot | null = null;
  private tickFloat = 0;
  private robotSprites = new Map<string, Container>();
  private pkgSprites = new Map<string, Container>();
  private revisionRendered = -1;
  private lastRouteTick = -1;
  private cam = { x: 0, y: 0, scale: 1 };
  private dragging = false;
  private dragStart = { x: 0, y: 0, cx: 0, cy: 0 };
  private moved = false;
  private viewW = 800;
  private viewH = 600;
  private selectedRobotId: string | null = null;
  private hoverCell: number | null = null;
  private mousePos = { x: 0, y: 0 };
  private tool: string = 'select';
  private editMode: boolean = false;
  private landingDrift = false;
  private cb: RendererCallbacks;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, cb: RendererCallbacks = {}) {
    this.app = new Application();
    this.cb = cb;
    void this.init(canvas);
  }

  private async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      backgroundColor: MAP.bg,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    if (this.destroyed) return;
    this.viewW = this.app.renderer.width / this.app.renderer.resolution;
    this.viewH = this.app.renderer.height / this.app.renderer.resolution;
    // Canvas text is baked into the cached static texture: rebuild it once the web fonts are ready.
    if (typeof document !== 'undefined' && document.fonts?.load) {
      void Promise.all([document.fonts.load("500 10px 'Geist Mono'"), document.fonts.load("400 10px 'Geist'")])
        .then(() => { if (!this.destroyed) this.revisionRendered = -1; })
        .catch(() => undefined);
    }
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.screenOverlay);
    this.world.addChild(this.routeLayer);
    this.world.addChild(this.pkgLayer);
    this.world.addChild(this.robotLayer);
    this.world.addChild(this.fxLayer);
    this.world.addChild(this.overlayLayer);
    this.buildMinimap();
    this.attachPointerHandlers(canvas);
    this.app.ticker.add(() => {
      try {
        this.frame();
      } catch (err) {
        // A bad art frame must never silently freeze the renderer; surface it loudly.
        console.error('[RoboArena] render frame failed:', err);
      }
    });
    this.resize();
  }

  resize(): void {
    try {
      if (!this.app || !this.app.renderer || this.destroyed) return;
      const canvas = this.app.canvas as HTMLCanvasElement;
      if (!canvas) return;
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 600;
      this.app.renderer.resize(w, h);
      this.viewW = w;
      this.viewH = h;
    } catch {
      // renderer already torn down
    }
  }

  fitToMap(): void {
    if (!this.scenario) return;
    const w = this.mapW * CELL_PX;
    const h = this.mapH * CELL_PX;
    const s = Math.min((this.viewW - 18) / w, (this.viewH - 18) / h);
    this.cam.scale = Math.max(0.25, Math.min(2.5, s));
    this.cam.x = (this.viewW - w * this.cam.scale) / 2;
    this.cam.y = (this.viewH - h * this.cam.scale) / 2;
    this.applyCamera();
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.mapW = scenario.map.width;
    this.mapH = scenario.map.height;
    this.revisionRendered = -1;
    this.robotSprites.clear();
    this.robotLayer.removeChildren();
    this.pkgSprites.clear();
    this.pkgLayer.removeChildren();
    this.routeLayer.clear();
    this.lastRouteTick = -1;
  }

  setPlan(plan: PlanResult | null): void {
    this.plan = plan;
    this.lastRouteTick = -1;
    this.rebuildPackageMarkers();
  }

  setSnapshot(snapshot: SimSnapshot, tickFloat: number): void {
    this.snapshot = snapshot;
    this.tickFloat = tickFloat;
  }

  setSelectedRobot(id: string | null): void {
    this.selectedRobotId = id;
    this.lastRouteTick = -1; // redraw route emphasis
  }

  setTool(tool: string, editMode: boolean): void {
    this.tool = tool;
    this.editMode = editMode;
  }

  /** Switch the canvas palette (light = paper plan, dark = graphite) and rebuild everything that bakes colour. */
  setTheme(name: CanvasThemeName): void {
    setCanvasTheme(name);
    if (this.destroyed) return;
    try {
      if (this.app?.renderer) this.app.renderer.background.color = MAP.bg;
      this.revisionRendered = -1; // static floor/racks texture
      this.robotSprites.clear(); // robots, badges
      this.robotLayer.removeChildren();
      this.lastRouteTick = -1; // routes
      if (this.scenario) this.rebuildPackageMarkers();
      if (this.minimap.parent) this.buildMinimap();
    } catch {
      // renderer still initialising: init() reads MAP.bg and the first frame builds with the new palette
    }
  }

  setLandingDrift(on: boolean): void {
    this.landingDrift = on && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (on && !this.landingDrift) return;
    if (on) this.fitToMap();
  }

  private selectedTaskIds = new Set<string>();
  private hoveredPackageId: string | null = null;
  setSelectedTasks(ids: Set<string>, hoverId: string | null): void {
    this.selectedTaskIds = ids;
    this.hoveredPackageId = hoverId;
    this.rebuildPackageMarkers();
  }

  private buildMinimap(): void {
    const mm = this.minimap;
    // (re)buildable: drop any previous background/title, keep the live dot/view graphics
    for (const ch of mm.removeChildren()) if (ch !== this.minimapDots && ch !== this.minimapView) ch.destroy({ children: true });
    const bg = new Graphics();
    bg.roundRect(0, 0, 148, 108, 6).fill({ color: MAP.minimapBg, alpha: 0.94 });
    bg.roundRect(0, 0, 148, 108, 6).stroke({ width: 1, color: MAP.minimapStroke, alpha: 0.95 });
    mm.addChild(bg);
    mm.addChild(this.minimapDots);
    mm.addChild(this.minimapView);
    mm.label = 'minimap';
    this.screenOverlay.addChild(mm);
    const title = new Text({
      text: 'MAP',
      style: { fontFamily: FONT.mono, fontSize: 8, fontWeight: '500', fill: MAP.minimapTitle, letterSpacing: 1.8 },
    });
    title.x = 6;
    title.y = 4;
    mm.addChild(title);
  }

  private frame(): void {
    if (!this.scenario) return;
    if (this.landingDrift) {
      // slow presentation drift across the map (genuine render, reduced-motion aware)
      const t = performance.now() / 1000;
      const w = this.mapW * CELL_PX;
      const h = this.mapH * CELL_PX;
      const scale = Math.min((this.viewW - 18) / w, (this.viewH - 18) / h) * 1.15;
      this.cam.scale = scale;
      this.cam.x = -((Math.sin(t * 0.05) * 0.5 + 0.5) * (w * scale - this.viewW));
      this.cam.y = -((Math.sin(t * 0.037 + 1.3) * 0.5 + 0.5) * (h * scale - this.viewH));
      this.applyCamera();
    }
    const map = this.scenario.map;
    if (map.revision !== this.revisionRendered) {
      if (this.staticSprite) {
        this.world.removeChild(this.staticSprite);
        this.staticSprite.destroy();
      }
      // keep route/pkg/robot layers in front: re-add static below them
      this.world.addChildAt(this.buildStaticSprite(), 0);
      this.revisionRendered = map.revision;
      this.rebuildPackageMarkers();
    }
    const snap = this.snapshot;
    // robots
    if (snap) {
      const seen = new Set<string>();
      for (const rv of snap.robots) {
        seen.add(rv.id);
        rememberRobotType(rv.id, rv.type);
        let sprite = this.robotSprites.get(rv.id);
        if (!sprite) {
          sprite = buildRobotSprite(rv);
          this.robotSprites.set(rv.id, sprite);
          this.robotLayer.addChild(sprite);
        }
        const ix = (rv.prevCell % this.mapW) + ((rv.cell % this.mapW) - (rv.prevCell % this.mapW)) * rv.moveFraction;
        const iyRaw = Math.floor(rv.prevCell / this.mapW) + (Math.floor(rv.cell / this.mapW) - Math.floor(rv.prevCell / this.mapW)) * rv.moveFraction;
        // interpolate in world space, wrapping-safe (cells are adjacent)
        const px = (xOf({ width: this.mapW }, rv.prevCell) + (xOf({ width: this.mapW }, rv.cell) - xOf({ width: this.mapW }, rv.prevCell)) * rv.moveFraction) * CELL_PX + CELL_PX / 2;
        const py = (yOf({ width: this.mapW }, rv.prevCell) + (yOf({ width: this.mapW }, rv.cell) - yOf({ width: this.mapW }, rv.prevCell)) * rv.moveFraction) * CELL_PX + CELL_PX / 2;
        void ix;
        void iyRaw;
        sprite.position.set(px, py);
        const targetRot = rv.dir * (Math.PI / 2); // art faces up (N=0)
        const body = sprite.getChildByName('body');
        if (body) body.rotation = targetRot;
        updateRobotCargo(sprite, rv);
        updateRobotRing(sprite, rv, this.tickFloat);
        sprite.alpha = rv.state === 'idle' && snap.status !== 'running' ? 0.92 : 1;
      }
      for (const [id, sprite] of this.robotSprites) {
        if (!seen.has(id)) sprite.visible = false;
      }
      // package states - carried/delivered leave the slot; pickup animates the slide
      const slide = this.pickupSlideInfo(snap, this.tickFloat);
      for (const [id, state] of Object.entries(snap.packageStates)) {
        const sprite = this.pkgSprites.get(id);
        if (!sprite) continue;
        const base = this.basePositions.get(id)!;
        sprite.visible = state !== 'carried' && state !== 'delivered';
        sprite.position.set(base.x, base.y);
        sprite.scale.set(1);
        sprite.alpha = 1;
      }
      if (slide) {
        const sprite = this.pkgSprites.get(slide.taskId);
        if (sprite && sprite.visible) {
          sprite.position.set(
            slide.from.x + (slide.to.x - slide.from.x) * slide.f,
            slide.from.y + (slide.to.y - slide.from.y) * slide.f,
          );
          sprite.scale.set(1 - slide.f * 0.45);
          sprite.alpha = 1 - slide.f * 0.6;
        }
      }
      this.drawDeliveries(snap);
      this.drawGhostPreview();
      this.drawRoutes(snap);
      this.drawSelectionOverlay();
      this.drawMinimap(snap);
      this.drawTooltip();
    }
  }

  private buildStaticSprite(): Sprite {
    const rt = buildStaticArt(this.app.renderer, this.scenario!.map, this.scenario!.packages);
    const sprite = new Sprite(rt);
    sprite.scale.set(0.5); // RT is 2x resolution
    sprite.label = 'staticMap'; // deterministic handle for tests/E2E
    this.staticSprite = sprite;
    return sprite;
  }

  private rebuildPackageMarkers(): void {
    this.pkgSprites.clear();
    this.pkgLayer.removeChildren();
    if (!this.scenario) return;
    for (const p of this.scenario.packages) {
      const info: PackageMarkerInfo = {
        id: p.id,
        shape: p.shape,
        seed: p.seed,
        cell: p.cell,
        mapW: this.mapW,
        state: p.state,
      };
      const selected = this.plan?.taskStates[p.id] === 'assigned' || this.selectedTaskIds.has(p.id) || this.hoveredPackageId === p.id;
      const marker = buildPackageMarker(info, selected);
      marker.scale.set(1);
      this.pkgSprites.set(p.id, marker);
      this.pkgLayer.addChild(marker);
    }
    this.basePositions.clear();
    for (const p of this.scenario.packages) {
      this.basePositions.set(p.id, {
        x: xOf({ width: this.mapW }, p.cell) * CELL_PX,
        y: yOf({ width: this.mapW }, p.cell) * CELL_PX,
      });
    }
  }

  private basePositions = new Map<string, { x: number; y: number }>();

  private drawRoutes(snap: SimSnapshot): void {
    if (!this.plan) {
      this.routeLayer.clear();
      return;
    }
    const tick = Math.floor(this.tickFloat);
    if (tick === this.lastRouteTick && this.snapshot === snap) return;
    this.lastRouteTick = tick;
    const g = this.routeLayer;
    g.clear();
    for (const rp of this.plan.plans) {
      const rt = snap.robots.find((r) => r.id === rp.robotId)?.type;
      const isFocus = this.selectedRobotId === null || this.selectedRobotId === rp.robotId;
      const color = robotColor(rp.robotId, rt);
      // focus mode: the selected robot's route at full strength, others subdued - no spaghetti
      const prevAlpha = g.alpha;
      g.alpha = isFocus ? 1 : 0.22;
      drawRoute(g, rp.steps, this.mapW, color, 0, tick);
      for (const pe of rp.pickupEvents) {
        if (pe.tick < tick) continue;
        const px = (pe.cell % this.mapW) * CELL_PX + CELL_PX / 2;
        const py = Math.floor(pe.cell / this.mapW) * CELL_PX + CELL_PX / 2;
        g.circle(px, py, 6).stroke({ width: 1.25, color, alpha: 0.6 });
      }
      // wait markers: small pause bars at planner-inserted waits
      for (const st of rp.steps) {
        if (!st.wait || st.departTick <= tick) continue;
        const wx = (st.cell % this.mapW) * CELL_PX + CELL_PX / 2;
        const wy = Math.floor(st.cell / this.mapW) * CELL_PX + CELL_PX / 2;
        g.rect(wx - 3, wy - 4, 2, 8).fill({ color: MAP.waitRing, alpha: 0.9 });
        g.rect(wx + 1, wy - 4, 2, 8).fill({ color: MAP.waitRing, alpha: 0.9 });
      }
      g.alpha = prevAlpha;
    }
    // trails (actual traveled path) - solid faint line
    for (const rv of snap.robots) {
      const rp = this.plan.plans.find((p) => p.robotId === rv.id);
      if (!rp || rv.moveFraction === 0) continue;
      const px = (xOf({ width: this.mapW }, rv.prevCell)) * CELL_PX + CELL_PX / 2;
      const py = (yOf({ width: this.mapW }, rv.prevCell)) * CELL_PX + CELL_PX / 2;
      const cx = (xOf({ width: this.mapW }, rv.cell)) * CELL_PX + CELL_PX / 2;
      const cy = (yOf({ width: this.mapW }, rv.cell)) * CELL_PX + CELL_PX / 2;
      g.moveTo(px, py).lineTo(cx, cy).stroke({ width: 2.5, color: robotColor(rv.id, rv.type), alpha: 0.28 });
    }
  }

  private drawSelectionOverlay(): void {
    const g = this.overlayLayer;
    g.clear();
    if (this.selectedRobotId) {
      const rv = this.snapshot?.robots.find((r) => r.id === this.selectedRobotId);
      if (rv) {
        const px = (xOf({ width: this.mapW }, rv.cell)) * CELL_PX + CELL_PX / 2;
        const py = (yOf({ width: this.mapW }, rv.cell)) * CELL_PX + CELL_PX / 2;
        const r = rv.type === 'H10' ? 24 : 20;
        const c = robotColor(rv.id, rv.type);
        // corner brackets
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          g.moveTo(px + sx * r, py + sy * r - sy * 8).lineTo(px + sx * r, py + sy * r).lineTo(px + sx * r - sx * 8, py + sy * r).stroke({ width: 2, color: c, alpha: 0.95 });
        }
      }
    }
    if (this.hoverCell !== null) {
      const hx = (this.hoverCell % this.mapW) * CELL_PX;
      const hy = Math.floor(this.hoverCell / this.mapW) * CELL_PX;
      g.rect(hx + 0.5, hy + 0.5, CELL_PX - 1, CELL_PX - 1).stroke({ width: 1, color: MAP.hoverStroke, alpha: 0.35 });
    }
  }

  private drawMinimap(snap: SimSnapshot): void {
    const mw = 136;
    const mh = 96;
    const sx = mw / (this.mapW * CELL_PX);
    const sy = mh / (this.mapH * CELL_PX);
    this.minimap.position.set(this.viewW - 160, this.viewH - 122);
    const dots = this.minimapDots;
    dots.clear();
    for (const rv of snap.robots) {
      const px = (xOf({ width: this.mapW }, rv.cell) * CELL_PX) * sx;
      const py = (yOf({ width: this.mapW }, rv.cell) * CELL_PX) * sy;
      dots.circle(6 + px, 14 + py, 1.8).fill({ color: robotColor(rv.id, rv.type), alpha: 0.95 });
    }
    const view = this.minimapView;
    view.clear();
    const vx = (-this.cam.x / this.cam.scale) * sx;
    const vy = (-this.cam.y / this.cam.scale) * sy;
    const vw = (this.viewW / this.cam.scale) * sx;
    const vh = (this.viewH / this.cam.scale) * sy;
    view.rect(6 + vx, 14 + vy, vw, vh).stroke({ width: 1, color: MAP.minimapView, alpha: 0.7 });
  }

  /** The package currently sliding from its slot into the robot (pickup dwell animation). */
  private pickupSlideInfo(
    snap: SimSnapshot,
    tickFloat: number,
  ): { taskId: string; from: { x: number; y: number }; to: { x: number; y: number }; f: number } | null {
    if (!this.plan) return null;
    for (const rv of snap.robots) {
      const rp = this.plan.plans.find((pl) => pl.robotId === rv.id);
      if (!rp) continue;
      const dw = rp.dwellSteps.find((d) => {
        const st = rp.steps[d.stepIndex];
        return st.arriveTick <= tickFloat && tickFloat < st.departTick;
      });
      if (!dw || dw.kind !== 'pickup') continue;
      const step = rp.steps[dw.stepIndex];
      const pe = rp.pickupEvents.find((e) => e.tick === step.departTick);
      if (!pe) continue;
      const f = Math.max(0, Math.min(1, (tickFloat - step.arriveTick) / Math.max(1, step.departTick - step.arriveTick)));
      const from = this.basePositions.get(pe.taskId);
      if (!from) continue;
      const to = {
        x: xOf({ width: this.mapW }, rv.cell) * CELL_PX + CELL_PX / 2,
        y: yOf({ width: this.mapW }, rv.cell) * CELL_PX + CELL_PX / 2,
      };
      return { taskId: pe.taskId, from, to, f };
    }
    return null;
  }

  /** Delivered goods accumulate visibly at the dock: mini crates + a progress counter. */
  private drawDeliveries(snap: SimSnapshot): void {
    const g = this.fxLayer;
    g.clear();
    if (!this.plan) return;
    const tick = Math.floor(this.tickFloat);
    const perDock = new Map<number, number>();
    for (const rp of this.plan.plans) {
      for (const ue of rp.unloadEvents) {
        if (ue.tick > tick) continue;
        const n = perDock.get(ue.cell) ?? 0;
        if (n < 10) perDock.set(ue.cell, n + 1);
      }
    }
    let total = 0;
    for (const [cell, n] of perDock) {
      total += n;
      const bx = (cell % this.mapW) * CELL_PX;
      const by = Math.floor(cell / this.mapW) * CELL_PX;
      for (let i = 0; i < n; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        g.rect(bx + 3 + col * 13, by + 2 + row * 7, 11, 5.5).fill({ color: 0xc9975c, alpha: 0.95 });
        g.rect(bx + 3 + col * 13, by + 2 + row * 7, 11, 1).fill({ color: 0xe0b479, alpha: 0.9 });
      }
    }
    if (total > 0) {
      const firstDock = perDock.keys().next().value as number | undefined;
      if (firstDock !== undefined) {
        const label = new Text({
          text: `${total}/${snap.metrics.selected || total} delivered`,
          style: { fontFamily: FONT.mono, fontSize: 10, fontWeight: '600', fill: MAP.ok },
        });
        const bx = (firstDock % this.mapW) * CELL_PX;
        const by = Math.floor(firstDock / this.mapW) * CELL_PX;
        const bg = new Graphics();
        bg.roundRect(bx - 2, by - 16, label.width + 12, 14, 4).fill({ color: MAP.badgeBg, alpha: 0.94 });
        bg.roundRect(bx - 2, by - 16, label.width + 12, 14, 4).stroke({ width: 1, color: MAP.ok, alpha: 0.7 });
        label.x = bx + 4;
        label.y = by - 13;
        bg.addChild(label);
        this.world.addChild(bg);
        this.tempOverlays.push(bg);
      }
    }
    this.flushTempOverlays();
  }

  private tempOverlays: Container[] = [];
  private flushTempOverlays(): void {
    if (this.tempOverlays.length > 1) {
      const keep = this.tempOverlays[this.tempOverlays.length - 1];
      for (const c of this.tempOverlays) if (c !== keep) c.destroy({ children: true });
      this.tempOverlays = [keep];
    }
  }

  /** Edit ghost preview: valid = teal tint, invalid = red tint at the hovered cell. */
  private drawGhostPreview(): void {
    const g = this.overlayLayer;
    if (!this.editMode || this.hoverCell === null || !this.scenario) return;
    const t = this.scenario.map.cells[this.hoverCell];
    const occupied = this.scenario.packages.some((p) => p.cell === this.hoverCell);
    const robotHere = this.scenario.robots.some((r) => r.homeCell === this.hoverCell);
    let ok = false;
    if (this.tool === 'rack') ok = t === 0 && !robotHere;
    else if (this.tool === 'package') ok = t === 1 && !occupied;
    else if (this.tool === 'move') ok = t === 1 && !occupied;
    else return;
    const hx = (this.hoverCell % this.mapW) * CELL_PX;
    const hy = Math.floor(this.hoverCell / this.mapW) * CELL_PX;
    g.rect(hx + 1, hy + 1, CELL_PX - 2, CELL_PX - 2).fill({ color: ok ? 0x2dd4bf : 0xf87171, alpha: 0.22 });
    g.rect(hx + 1, hy + 1, CELL_PX - 2, CELL_PX - 2).stroke({ width: 1.5, color: ok ? 0x2dd4bf : 0xf87171, alpha: 0.85 });
  }

  /** Small hover tooltip drawn in screen space - no React involvement per pointer-move. */
  private drawTooltip(): void {
    const existing = this.screenOverlay.getChildByName('tooltip');
    if (existing) existing.destroy({ children: true });
    if (this.hoverCell === null || !this.scenario || !this.snapshot) return;
    let lines: string[] | null = null;
    let color: number = MAP.tooltipText2;
    const pkg = this.scenario.packages.find((p) => p.cell === this.hoverCell);
    const robot = this.snapshot.robots.find((r) => r.cell === this.hoverCell);
    if (robot) {
      lines = [`${robot.id} · ${robot.type === 'H10' ? 'Hauler' : 'Scout'}`, `cargo ${robot.cargo.length}/${robot.capacity} · ${robot.state}`];
      color = robotColor(robot.id, robot.type);
    } else if (pkg) {
      const st = this.snapshot.packageStates[pkg.id];
      lines = [`${pkg.id} · ${pkg.shape}`, `${pkg.shelfLabel} · ${st}`];
      color = MAP.pkgAccent;
    } else if (this.scenario.map.cells[this.hoverCell] === 1) {
      lines = ['Empty rack slot', 'package can be placed here'];
    } else if (this.scenario.map.cells[this.hoverCell] === 3) {
      lines = ['Delivery dock'];
    }
    if (!lines) return;
    const tip = new Container();
    tip.label = 'tooltip';
    const bg = new Graphics();
    const w = Math.max(...lines.map((l) => l.length)) * 5.6 + 16;
    bg.roundRect(0, 0, w, lines.length * 13 + 10, 5).fill({ color: MAP.tooltipBg, alpha: 0.97 });
    bg.roundRect(0, 0, w, lines.length * 13 + 10, 5).stroke({ width: 1, color: MAP.tooltipStroke, alpha: 0.95 });
    lines.forEach((l, i) => {
      const t = new Text({
        text: l,
        style: { fontFamily: FONT.ui, fontSize: 10, fontWeight: i === 0 ? '600' : '400', fill: i === 0 ? color : MAP.tooltipText2 },
      });
      t.x = 8;
      t.y = 5 + i * 13;
      bg.addChild(t);
    });
    tip.addChild(bg);
    tip.x = Math.min(this.mousePos.x + 14, this.viewW - w - 8);
    tip.y = this.mousePos.y + 16;
    this.screenOverlay.addChild(tip);
  }

  private applyCamera(): void {
    this.world.scale.set(this.cam.scale);
    this.world.position.set(this.cam.x, this.cam.y);
  }

  private attachPointerHandlers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = false;
      this.dragStart = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.dragging) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
        this.cam.x = this.dragStart.cx + dx;
        this.cam.y = this.dragStart.cy + dy;
        this.applyCamera();
      }
      const worldX = (e.clientX - rect.left - this.cam.x) / this.cam.scale;
      const worldY = (e.clientY - rect.top - this.cam.y) / this.cam.scale;
      const cx = Math.floor(worldX / CELL_PX);
      const cy = Math.floor(worldY / CELL_PX);
      if (cx >= 0 && cy >= 0 && cx < this.mapW && cy < this.mapH) {
        this.hoverCell = cy * this.mapW + cx;
        this.cb.onCellHover?.(this.hoverCell);
      } else {
        this.hoverCell = null;
        this.cb.onCellHover?.(null);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasDrag = this.moved;
      this.dragging = false;
      if (wasDrag) return;
      const rect = canvas.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - this.cam.x) / this.cam.scale;
      const worldY = (e.clientY - rect.top - this.cam.y) / this.cam.scale;
      const cx = Math.floor(worldX / CELL_PX);
      const cy = Math.floor(worldY / CELL_PX);
      if (cx < 0 || cy < 0 || cx >= this.mapW || cy >= this.mapH) {
        this.cb.onEmptyClick?.();
        return;
      }
      this.cb.onCellClick?.(cy * this.mapW + cx, e.shiftKey);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(0.28, Math.min(4, this.cam.scale * factor));
      const wx = (mx - this.cam.x) / this.cam.scale;
      const wy = (my - this.cam.y) / this.cam.scale;
      this.cam.x = mx - wx * newScale;
      this.cam.y = my - wy * newScale;
      this.cam.scale = newScale;
      this.applyCamera();
    }, { passive: false });
  }

  destroy(): void {
    this.destroyed = true;
    try {
      // PixiJS 8.6 destroy() can throw internally (e.g. _cancelResize when resizeTo is unset);
      // swallow so React StrictMode remounts cleanly.
      this.app.destroy(true, { children: true });
    } catch {
      // ignore
    }
  }
}

export function formatSimTime(tick: number): string {
  const totalSec = Math.floor(tick * TICK_SECONDS);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export { CSS as cssRef };
