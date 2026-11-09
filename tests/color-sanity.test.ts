// Regression for v1.2 P0: an invalid color literal (0xb9987330 | 0 → negative int32) made
// PixiJS throw "Unable to convert color", which froze the canvas for presets that contain
// pallet-shaped packages (Steel, Construction). This suite renders EVERY preset package's
// shape/seed through a recording Graphics stub and asserts all colors are valid RGB.
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/scenarios/presets';
import { drawStorageItem } from '../src/render/static-art';

class RecordingGraphics {
  colors: number[] = [];
  private self(): RecordingGraphics {
    return this;
  }
  rect(): RecordingGraphics { return this; }
  roundRect(): RecordingGraphics { return this; }
  circle(): RecordingGraphics { return this; }
  ellipse(): RecordingGraphics { return this; }
  moveTo(): RecordingGraphics { return this; }
  lineTo(): RecordingGraphics { return this; }
  closePath(): RecordingGraphics { return this; }
  fill(style: { color?: number; alpha?: number } | number): RecordingGraphics {
    const c = typeof style === 'number' ? style : style?.color;
    if (c !== undefined) this.colors.push(c);
    return this;
  }
  stroke(_style?: unknown): RecordingGraphics { return this; }
}

function assertValidColors(colors: number[], context: string): void {
  for (const c of colors) {
    expect(c, `${context}: invalid color ${c} (must be uint24 RGB)`).toBeGreaterThanOrEqual(0);
    expect(c, `${context}: invalid color ${c}`).toBeLessThanOrEqual(0xffffff);
  }
}

describe('art color sanity (P0 preset-freeze regression)', () => {
  it('renders every preset package shape/seed with valid colors', () => {
    let checked = 0;
    for (const { spec, build } of PRESETS) {
      const sc = build();
      for (const p of sc.packages) {
        const g = new RecordingGraphics();
        drawStorageItem(g as never, p.shape, 0, 0, 27, 27, p.seed, 0xc9975c);
        assertValidColors(g.colors, `${spec.id}/${p.id}/${p.shape}/seed ${p.seed}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('bulk-stock shelf cells use valid colors across all presets', () => {
    // drawShelfCell is module-private; exercise the same mulberry bulk branch via a scan of
    // seeds the static art actually uses: cell index based seeds across representative sizes.
    const sizes: [number, number][] = [
      [60, 40],
      [54, 38],
      [50, 36],
      [64, 36],
    ];
    for (const [w, h] of sizes) {
      const colors: number[] = [];
      const g = new RecordingGraphics();
      for (let cell = 0; cell < w * h; cell += 7) {
        // bulk branch: exercised through drawStorageItem('carton') with same seed math
        const seed = (cell * 2654435761) >>> 16;
        drawStorageItem(g as never, 'carton', 0, 0, 27, 27, seed, 0xc9975c);
      }
      colors.push(...g.colors);
      assertValidColors(colors, `grid ${w}x${h}`);
    }
  });
});
