// Store-level regression tests for the two audited P0 defects.
// Shims for browser globals the store singleton expects in a node environment.
const localStorageMock = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void m.clear(),
  };
})();
(globalThis as Record<string, unknown>).localStorage = localStorageMock;
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(Date.now()), 16) as unknown as number;
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

import { describe, expect, it } from 'vitest';
import { missionFingerprint } from '../src/engine/mission';
import { buildPreset } from '../src/scenarios/presets';

describe('mission fingerprint (stale-plan protection)', () => {
  const sc = buildPreset('ecommerce');

  it('is stable for identical inputs', () => {
    const tasks = sc.packages.slice(0, 5).map((p) => p.id);
    const robots = sc.robots.slice(0, 2).map((r) => r.id);
    expect(missionFingerprint(sc, tasks, robots)).toBe(missionFingerprint(sc, [...tasks].reverse(), [...robots]));
  });

  it('changes when the task set changes', () => {
    const a = sc.packages.slice(0, 5).map((p) => p.id);
    const b = sc.packages.slice(0, 6).map((p) => p.id);
    const robots = sc.robots.slice(0, 2).map((r) => r.id);
    expect(missionFingerprint(sc, a, robots)).not.toBe(missionFingerprint(sc, b, robots));
  });

  it('changes when the fleet changes (size, type, capacity, home)', () => {
    const tasks = sc.packages.slice(0, 5).map((p) => p.id);
    const two = sc.robots.slice(0, 2).map((r) => r.id);
    const three = sc.robots.slice(0, 3).map((r) => r.id);
    expect(missionFingerprint(sc, tasks, two)).not.toBe(missionFingerprint(sc, tasks, three));
    const swapped = [sc.robots[1].id, sc.robots[0].id]; // same set, different order — must be equal
    expect(missionFingerprint(sc, tasks, two)).toBe(missionFingerprint(sc, tasks, swapped));
  });

  it('changes when a selected package moves or the map revision bumps', () => {
    const tasks = sc.packages.slice(0, 5).map((p) => p.id);
    const robots = sc.robots.slice(0, 2).map((r) => r.id);
    const moved = buildPreset('ecommerce');
    moved.packages[0].cell = moved.packages[0].cell + 1;
    moved.map.revision = 2;
    expect(missionFingerprint(sc, tasks, robots)).not.toBe(missionFingerprint(moved, tasks, robots));
  });
});

describe('store mission lifecycle (P0-2)', () => {
  it('marks the plan stale after selection changes and clears it after replanning', () => {
    // dynamic import AFTER shims are installed
    return import('../src/state/store').then(({ store }) => {
      store.loadPreset('ecommerce');
      store.selectSampleMission(15);
      store.planMission();
      expect(store.planOutcome).not.toBeNull();
      expect(store.isPlanStale()).toBe(false);
      // selection changes → stale
      const someTask = store.scenario.packages.find((p) => !store.selectedTaskIds.has(p.id))!.id;
      store.toggleTask(someTask);
      expect(store.isPlanStale()).toBe(true);
      // play must refuse while stale
      const playingBefore = store.playing;
      store.play();
      expect(store.playing).toBe(playingBefore);
      // recompute clears staleness
      store.planMission();
      expect(store.isPlanStale()).toBe(false);
      // fleet change → stale again
      store.setFleetSize(4);
      expect(store.isPlanStale()).toBe(true);
    });
  });
});

describe('custom save/load (P0-1)', () => {
  it('round-trips a custom layout and rejects unknown IDs without touching the current scenario', async () => {
    const { store } = await import('../src/state/store');
    store.loadPreset('ecommerce');
    store.setMode('design');
    const W = store.scenario.map.width;
    const floorCell = 20 * W + 12;
    store.tool = 'rack';
    store.onCellClick(floorCell, false);
    expect(store.scenario.map.cells[floorCell]).toBe(1);
    store.saveCustom('Regression Layout');
    const customs = store.listCustoms();
    expect(customs.length).toBeGreaterThan(0);
    const savedId = customs[customs.length - 1].id;
    // switch away
    store.loadPreset('steel');
    expect(store.scenario.map.id).toBe('steel');
    // load custom back
    store.loadCustom(savedId);
    expect(store.scenario.map.id).toBe('ecommerce');
    expect(store.scenario.map.cells[floorCell]).toBe(1);
    expect(store.activePresetId).toBe(`custom:${savedId}`);
    // unknown id: error, current scenario untouched
    store.loadCustom('does-not-exist');
    expect(store.scenario.map.id).toBe('ecommerce');
    expect(store.toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});
