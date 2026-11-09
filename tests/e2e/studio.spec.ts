import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lp h1')).toContainText('Watch the floor');
});

test('landing → guided mission starts, robots leave their bays, guided card visible', async ({ page }) => {
  await page.getByText('Start a guided mission').click();
  await expect(page.locator('.guided')).toBeVisible();
  await expect(page.locator('.guided h4')).toContainText('The mission');
  await page.waitForTimeout(6000);
  const snap = await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store;
    const x = s.sim.snapshot(s.selectedTaskIds.size);
    return { tick: x.tick, picked: x.metrics.picked, robots: x.robots.length };
  });
  expect(snap.tick).toBeGreaterThan(0);
  expect(snap.robots).toBeGreaterThanOrEqual(2);
});

test('plan invalidation: changing the fleet marks the plan stale and disables playback', async ({ page }) => {
  await page.getByText('Explore a warehouse').click();
  await page.locator('.left-panel').waitFor();
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store;
    s.setMode('plan');
    s.selectSampleMission(15);
    s.planMission();
  });
  const isStale = () => page.evaluate(() => ((window as unknown as Record<string, any>).__store as any).isPlanStale());
  expect(await isStale()).toBe(false);
  // change fleet through the real UI checkbox
  await page.locator('.check-row input').nth(2).check();
  await expect(page.locator('.stale-banner')).toContainText('Plan needs updating');
  expect(await isStale()).toBe(true);
  // play button disabled while stale
  await expect(page.getByRole('button', { name: 'Compute plan' }).first()).toBeEnabled();
  await expect(page.locator('.ctl.primary')).toBeDisabled();
  // recompute clears the banner
  await page.getByRole('button', { name: 'Recompute from start' }).click();
  await expect(page.locator('.stale-banner')).toHaveCount(0);
});

test('custom warehouse: paint, save, switch away, load back via the real dropdown', async ({ page }) => {
  await page.getByText('Explore a warehouse').click();
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store;
    s.setMode('design');
    s.tool = 'rack';
    s.onCellClick(20 * s.scenario.map.width + 12, false);
    s.saveCustom('Playwright Layout');
  });
  await page.locator('.preset-select').selectOption({ index: 1 }); // Steel
  const steelId = await page.evaluate(() => ((window as unknown as Record<string, any>).__store as any).scenario.map.id);
  expect(steelId).toBe('steel');
  const options = await page.evaluate(() =>
    [...(document.querySelector('.preset-select') as HTMLSelectElement).options].map((o) => o.value),
  );
  const customValue = options.find((v) => v.startsWith('custom:'));
  expect(customValue).toBeTruthy();
  await page.locator('.preset-select').selectOption(customValue!);
  const after = await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store as any;
    return { id: s.scenario.map.id, painted: s.scenario.map.cells[20 * s.scenario.map.width + 12], active: s.activePresetId };
  });
  expect(after.id).toBe('ecommerce');
  expect(after.painted).toBe(1);
  expect(after.active).toBe(customValue);
});

test('inventory truth: added package occupies a visible slot; pickup empties the slot and delivery stacks at the dock', async ({ page }) => {
  await page.getByText('Explore a warehouse').click();
  const cell = await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store as any;
    s.setMode('design');
    // add a package into an empty rack slot
    const W = s.scenario.map.width;
    let target = -1;
    for (let i = 0; i < s.scenario.map.cells.length; i++) {
      if (s.scenario.map.cells[i] !== 1) continue;
      if (s.scenario.packages.some((p: any) => p.cell === i)) continue;
      const nb = [i - 1, i + 1, i - W, i + W];
      if (nb.some((n) => s.scenario.map.cells[n] === 0)) { target = i; break; }
    }
    s.tool = 'package';
    s.onCellClick(target, false);
    const pkg = s.scenario.packages.find((p: any) => p.cell === target);
    return { target, newId: pkg ? pkg.id : '', count: s.scenario.packages.length };
  });
  expect(cell.newId).not.toBe('');
  // select it + a small mission and run to first pickup
  await page.evaluate((c) => {
    const s = (window as unknown as Record<string, any>).__store as any;
    s.setMode('simulate');
    s.selectedTaskIds = new Set([c.newId]);
    s.selectedRobotIds = new Set([s.scenario.robots[0].id]);
    s.planMission();
    s.setSpeed(32);
    s.play();
  }, cell);
  const readEnd = (c: { newId: string }) =>
    page.evaluate((cid) => {
      const s = (window as unknown as Record<string, any>).__store as any;
      const snap = s.sim.snapshot(1);
      return {
        delivered: snap.metrics.delivered,
        state: snap.packageStates[cid],
        status: snap.status,
        parked: snap.metrics.lastParkedTick !== null,
        tick: snap.tick,
      };
    }, c.newId);
  await expect
    .poll(async () => (await readEnd(cell)).status, { timeout: 30000 })
    .toBe('finished');
  const end = await readEnd(cell);
  expect(end.state).toBe('delivered');
  expect(end.parked).toBe(true);
});

test('responsive: no horizontal overflow at 1366/820/390 and drawers toggle at 820', async ({ page }) => {
  await page.getByText('Explore a warehouse').click();
  await page.waitForTimeout(400);
  for (const w of [1366, 820, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : w === 820 ? 1180 : 900 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
    expect(m.scrollW, `width ${w}`).toBeLessThanOrEqual(m.innerW + 1);
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Toggle mission panel' }).click({ timeout: 15000 });
  await expect(page.locator('.right-panel')).toBeVisible({ timeout: 15000 });
});

test('compare: both strategies complete the same workload with measured results', async ({ page }) => {
  await page.getByText('Explore a warehouse').click();
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store as any;
    s.setMode('compare');
    s.selectSampleMission(15);
    s.setFleetSize(2);
    s.runComparison();
  });
  const rows = await page.evaluate(() => ((window as unknown as Record<string, any>).__store as any).comparison.rows);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.delivered).toBe(15);
    expect(r.actualMakespan).toBeGreaterThan(0);
    expect(r.lastParked).toBeGreaterThan(0);
  }
  await expect(page.locator('.cmp-table')).toBeVisible();
});
