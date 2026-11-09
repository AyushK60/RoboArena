import { test } from '@playwright/test';

// Captures landing/studio screenshots into test-results/screenshots
const shots = 'test-results/screenshots';

test('v121 landing + studio captures', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${shots}/v121-landing-1600.png` });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/v121-landing-1366.png` });
  // scrolled: flow + warehouses
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('.lp-wgrid').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/v121-landing-sections.png` });
  // tablet + phone
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/v121-landing-820.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/v121-landing-390.png` });
  console.log('landing overflow 820:', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  // studio
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByText('Explore a warehouse').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/v121-studio-design.png` });
  // mission run shot
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, any>).__store as any;
    s.setMode('simulate');
    s.selectSampleMission(15);
    s.planMission();
    s.setSpeed(4);
    s.play();
  });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${shots}/v121-studio-running.png` });
  // all four presets render (dropdown)
  for (const pid of ['ecommerce', 'steel', 'construction', 'crossdock']) {
    await page.evaluate((p) => {
      const s = (window as unknown as Record<string, any>).__store as any;
      s.loadPreset(p);
      s.setMode('design');
    }, pid);
    await page.waitForTimeout(900);
    const ok = await page.evaluate(() => {
      const r = (window as unknown as Record<string, any>).__store.renderer.raw;
      return { hasStatic: !!r.world.getChildByName('staticMap'), id: (window as unknown as Record<string, any>).__store.scenario.map.id };
    });
    console.log(`preset ${pid}:`, JSON.stringify(ok));
    await page.screenshot({ path: `${shots}/v121-preset-${pid}.png` });
  }
  console.log('console errors:', errors.length, errors.slice(0, 3));
});
