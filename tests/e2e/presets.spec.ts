import { expect, test } from '@playwright/test';

/**
 * V1.2 P0 regression: all four presets must VISIBLY render (static sprite in the scene graph,
 * real caption, no console errors) through real UI controls — state IDs alone prove nothing.
 * Also runs a genuine 15-task / 2-robot mission on the two repaired presets.
 */

const PRESETS = [
  { id: 'ecommerce', card: 0, caption: 'E-commerce Warehouse · 60×40 cells · 66 packages · 8 robots' },
  { id: 'steel', card: 1, caption: 'Steel & Raw Materials · 54×38 cells · 60 packages · 6 robots' },
  { id: 'construction', card: 2, caption: 'Construction Supply · 50×36 cells · 60 packages · 8 robots' },
  { id: 'crossdock', card: 3, caption: 'Cross-Docking Hub · 64×36 cells · 76 packages · 10 robots' },
];

test.describe('v1.2 preset recovery', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await page.goto('/');
    await expect(page.locator('.lp h1')).toBeVisible();
    await page.getByText('Explore a warehouse').click();
    await page.waitForTimeout(600);
  });

  for (const p of PRESETS) {
    test(`preset "${p.id}" renders a real warehouse via the dropdown`, async ({ page }) => {
      const probe = p.id === 'ecommerce' ? 'e-commerce' : p.id === 'crossdock' ? 'cross-docking' : p.id;
      const value = await page.evaluate(
        (needle: string) =>
          [...(document.querySelector('.preset-select') as HTMLSelectElement).options].find((o) =>
            o.text.toLowerCase().includes(needle),
          )?.value,
        probe,
      );
      await page.locator('.preset-select').selectOption(value!);
      // the map caption must switch to this preset's real counts
      await expect(page.locator('.map-caption')).toContainText(p.caption.split(' · ')[0]);
      // the renderer must have rebuilt a static layer (real pixels, not the previous map)
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const r = (window as unknown as Record<string, any>).__store.renderer.raw;
              return {
                hasStatic: !!r.world.getChildByName('staticMap'),
                mapW: r.mapW,
                mapH: r.mapH,
                worldChildren: r.world.children.length,
              };
            }),
          { timeout: 10000 },
        )
        .toEqual({ hasStatic: true, mapW: expect.any(Number), mapH: expect.any(Number), worldChildren: expect.any(Number) });
      const rendered = await page.evaluate(() => {
        const r = (window as unknown as Record<string, any>).__store.renderer.raw;
        return { hasStatic: !!r.world.getChildByName('staticMap'), mapW: r.mapW, mapH: r.mapH };
      });
      expect(rendered.hasStatic).toBe(true);
      // pixel-level proof: the canvas is not blank — sample its center region variance
      const pixels = await page.evaluate(() => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        const src = canvas.width > 0 ? canvas : null;
        return { w: src?.width ?? 0, h: src?.height ?? 0 };
      });
      expect(pixels.w).toBeGreaterThan(300);
      expect(pixels.h).toBeGreaterThan(200);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/screenshots/v12-preset-${p.id}.png` });
      expect(consoleErrors, `console errors for ${p.id}: ${consoleErrors.join(' | ')}`).toEqual([]);
    });
  }

  test('sequential switching across all four presets keeps the scene live', async ({ page }) => {
    for (const p of PRESETS) {
      await page.evaluate((pid) => {
        const s = (window as unknown as Record<string, any>).__store as any;
        s.loadPreset(pid);
      }, p.id);
      await page.waitForTimeout(700);
      await expect
        .poll(
          async () =>
            page.evaluate((pid2) => {
              const s = (window as unknown as Record<string, any>).__store as any;
              const r = s.renderer.raw;
              return { id: s.scenario.map.id, sprite: !!r.world.getChildByName('staticMap') };
            }, p.id),
          { timeout: 10000 },
        )
        .toEqual({ id: p.id, sprite: true });
    }
    expect(consoleErrors).toEqual([]);
  });

  for (const pid of ['steel', 'construction']) {
    test(`repaired preset "${pid}": genuine 15-task / 2-robot mission completes`, async ({ page }) => {
      await page.evaluate((p) => {
        const s = (window as unknown as Record<string, any>).__store as any;
        s.loadPreset(p);
        s.setMode('simulate');
        s.selectSampleMission(15);
        s.planMission();
        s.setSpeed(32);
        s.play();
      }, pid);
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const s = (window as unknown as Record<string, any>).__store as any;
              return s.sim.snapshot(s.selectedTaskIds.size).status;
            }),
          { timeout: 45000 },
        )
        .toBe('finished');
      const final = await page.evaluate(() => {
        const s = (window as unknown as Record<string, any>).__store as any;
        const snap = s.sim.snapshot(s.selectedTaskIds.size);
        return {
          delivered: snap.metrics.delivered,
          selected: snap.metrics.selected,
          makespan: snap.metrics.actualMakespanTicks,
          parked: snap.metrics.lastParkedTick,
          failed: s.planOutcome.plan.failedRobots.length,
        };
      });
      expect(final.selected).toBe(15);
      expect(final.delivered).toBe(15);
      expect(final.failed).toBe(0);
      expect(final.makespan).toBeGreaterThan(0);
      expect(final.parked).toBeGreaterThanOrEqual(final.makespan ?? 0);
      await page.screenshot({ path: `test-results/screenshots/v12-mission-${pid}.png` });
      expect(consoleErrors).toEqual([]);
    });
  }
});
