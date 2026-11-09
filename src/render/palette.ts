// Canvas themes ("Plan Sheet" v1.3).
//  - light: a printed floor plan — cream paper floor, navy rack outlines, kraft cartons,
//           Scout routes in navy and Hauler routes in vermilion (matches the landing schematic).
//  - dark:  warm graphite concrete with steel racks and cream markings (neutral, not blue).
// Meaningful colours (amber waits/packages, green success, vermilion restricted zones) exist in both.
// All render code reads the live `MAP` object, so switching theme = setCanvasTheme() + rebuild.

export type CanvasThemeName = 'dark' | 'light';

export interface CanvasTheme {
  name: CanvasThemeName;
  bg: number; // surround outside the floor plate
  floorByPreset: Record<string, number>; // per-preset floor tints
  floorBase: number;
  floorTile: number;
  floorSeam: number;
  floorScuff: number;
  vignette: number; // 0..1 multiplier
  zoneTints: Record<string, number>;
  safety: number;
  rackFrame: number;
  rackFrameDark: number;
  rackShadow: number;
  rackShadowAlpha: number;
  rackFoot: number;
  cavity1: number;
  cavity2: number;
  divider: number;
  sheen: number;
  debris: number;
  itemOutline: number;
  gridText: number;
  truckCab: number;
  truckBox: number;
  truckFlat: number;
  truckStroke: number;
  truckShadow: number;
  amber: number;
  cartonFills: number[];
  cartonCool: number[];
  tape: number;
  // robots
  s1Family: number[];
  h10Family: number[];
  robotChassisS1: number;
  robotChassisH10: number;
  robotBase: number;
  robotWheel: number;
  robotHub: number;
  robotPlate: number;
  robotVent: number;
  robotChevron: number;
  robotPost: number;
  robotLidar: number;
  robotShadow: number;
  robotShadowAlpha: number;
  stripeA: number;
  // overlays
  badgeBg: number;
  badgeText: number;
  ringTrack: number;
  pickRing: number;
  waitRing: number;
  ok: number;
  pkgAccent: number;
  hoverStroke: number;
  tooltipBg: number;
  tooltipStroke: number;
  tooltipText2: number;
  minimapBg: number;
  minimapStroke: number;
  minimapTitle: number;
  minimapView: number;
}

const DARK: CanvasTheme = {
  name: 'dark',
  bg: 0x0b0d0f,
  floorByPreset: { ecommerce: 0x1f2226, steel: 0x1d2125, construction: 0x23221f, crossdock: 0x1e2125 },
  floorBase: 0x1f2226,
  floorTile: 0x25292d,
  floorSeam: 0x2c3136,
  floorScuff: 0x181b1e,
  vignette: 1,
  zoneTints: {
    receiving: 0x6a9be0,
    shipping: 0x6a9be0,
    packing: 0xd9a441,
    charging: 0x3fcb8a,
    restricted: 0xff6b3d,
    staging: 0xc9bfa6,
    sorting: 0x33b8b0,
    storage: 0x7c8794,
  },
  safety: 0xe4dcc6,
  rackFrame: 0x8b929c,
  rackFrameDark: 0x4d545e,
  rackShadow: 0x050607,
  rackShadowAlpha: 0.4,
  rackFoot: 0xe4dcc6,
  cavity1: 0x2b2f35,
  cavity2: 0x24282d,
  divider: 0x3a4048,
  sheen: 0x30353b,
  debris: 0x1a1d20,
  itemOutline: 0x1a1d20,
  gridText: 0x8d939c,
  truckCab: 0x3a414b,
  truckBox: 0xe4dcc6,
  truckFlat: 0x8b929c,
  truckStroke: 0x16181b,
  truckShadow: 0x050607,
  amber: 0xf5a623,
  cartonFills: [0xc9975c, 0xb98a4f, 0xd4a76a, 0xa87f49, 0xc2935a],
  cartonCool: [0x9aa3b2, 0x8791a1, 0xa8b0bd],
  tape: 0x7d5e33,
  s1Family: [0x22d3ee, 0x2dd4bf, 0x38bdf8, 0x0ea5e9, 0x14b8a6, 0x67e8f9],
  h10Family: [0xf5a623, 0xfb923c, 0xeab308, 0xf59e0b, 0xd97706, 0xfbbf24],
  robotChassisS1: 0x2a2f36,
  robotChassisH10: 0x2e343c,
  robotBase: 0x1b1f24,
  robotWheel: 0x0d0f11,
  robotHub: 0x4a525c,
  robotPlate: 0x3a414a,
  robotVent: 0x131518,
  robotChevron: 0xeaf2ff,
  robotPost: 0xcfd6e2,
  robotLidar: 0x0f1113,
  robotShadow: 0x050607,
  robotShadowAlpha: 0.55,
  stripeA: 0xe4dcc6,
  badgeBg: 0x111418,
  badgeText: 0xefeae0,
  ringTrack: 0x3a4048,
  pickRing: 0x22d3ee,
  waitRing: 0xf5a623,
  ok: 0x34d399,
  pkgAccent: 0xf5a623,
  hoverStroke: 0xffffff,
  tooltipBg: 0x111418,
  tooltipStroke: 0x3a4048,
  tooltipText2: 0xa9adb4,
  minimapBg: 0x111418,
  minimapStroke: 0x343b45,
  minimapTitle: 0x858a93,
  minimapView: 0xefeae0,
};

const LIGHT: CanvasTheme = {
  name: 'light',
  bg: 0xe2dccd,
  floorByPreset: { ecommerce: 0xf3efe4, steel: 0xf1eee4, construction: 0xf4efe2, crossdock: 0xf2eee5 },
  floorBase: 0xf3efe4,
  floorTile: 0xece7da,
  floorSeam: 0xd8d2c2,
  floorScuff: 0xe6e0d1,
  vignette: 0,
  zoneTints: {
    receiving: 0x2f5fb3,
    shipping: 0x2f5fb3,
    packing: 0xb87a12,
    charging: 0x1f8a5b,
    restricted: 0xd4421c,
    staging: 0x8c8470,
    sorting: 0x0f7c80,
    storage: 0x5b697e,
  },
  safety: 0x0e2035,
  rackFrame: 0x3c5068,
  rackFrameDark: 0x0e2035,
  rackShadow: 0x0e2035,
  rackShadowAlpha: 0.16,
  rackFoot: 0x0e2035,
  cavity1: 0xe3ddcd,
  cavity2: 0xdad3c2,
  divider: 0xbdb6a3,
  sheen: 0xe9e4d6,
  debris: 0xcfc8b6,
  itemOutline: 0x0e2035,
  gridText: 0x5b697e,
  truckCab: 0x0e2035,
  truckBox: 0xfaf7f0,
  truckFlat: 0x9aa4b4,
  truckStroke: 0x0e2035,
  truckShadow: 0x0e2035,
  amber: 0xb87a12,
  cartonFills: [0xc9975c, 0xb98a4f, 0xd4a76a, 0xa87f49, 0xc2935a],
  cartonCool: [0x9aa3b2, 0x8791a1, 0xa8b0bd],
  tape: 0x7d5e33,
  s1Family: [0x0e2035, 0x1d3a5c, 0x2b4a73, 0x14304f, 0x23406a, 0x34567f],
  h10Family: [0xd4421c, 0xe2572f, 0xc23a17, 0xea6a3d, 0xb93514, 0xf07c52],
  robotChassisS1: 0xfaf7f0,
  robotChassisH10: 0xfaf7f0,
  robotBase: 0xc9c2ae,
  robotWheel: 0x2a3140,
  robotHub: 0x8a93a3,
  robotPlate: 0xe4dfd1,
  robotVent: 0xb5ad9a,
  robotChevron: 0x0e2035,
  robotPost: 0x5b697e,
  robotLidar: 0x0e2035,
  robotShadow: 0x0e2035,
  robotShadowAlpha: 0.22,
  stripeA: 0x0e2035,
  badgeBg: 0x0e2035,
  badgeText: 0xefeae0,
  ringTrack: 0xb5ad9a,
  pickRing: 0x2b4a73,
  waitRing: 0xb87a12,
  ok: 0x1f8a5b,
  pkgAccent: 0xb87a12,
  hoverStroke: 0x0e2035,
  tooltipBg: 0xf8f5ee,
  tooltipStroke: 0xb5ad9a,
  tooltipText2: 0x44546a,
  minimapBg: 0xf8f5ee,
  minimapStroke: 0xb5ad9a,
  minimapTitle: 0x5b697e,
  minimapView: 0x0e2035,
};

export const CANVAS_THEMES: Record<CanvasThemeName, CanvasTheme> = { dark: DARK, light: LIGHT };

/** Live canvas palette. Mutated in place by setCanvasTheme(); render code always reads it at draw time. */
export const MAP: CanvasTheme = { ...DARK };

export function setCanvasTheme(name: CanvasThemeName): void {
  Object.assign(MAP, CANVAS_THEMES[name]);
}

// Canvas text. Web fonts are loaded by index.html; the renderer rebuilds static art once they are ready.
export const FONT = {
  mono: "'Geist Mono', 'Cascadia Code', Consolas, monospace",
  ui: "'Geist', 'Segoe UI', system-ui, sans-serif",
} as const;

export const UI = {
  bg: 0x0f1114,
  panel: 0x15181c,
  panelBorder: 0x343b45,
  panelHeader: 0x111418,
  text: 0xefeae0,
  textDim: 0xa9adb4,
  textFaint: 0x858a93,
  accent: 0xff6b3d,
  cyan: 0x22d3ee,
  amber: 0xf5a623,
  green: 0x34d399,
  red: 0xf87171,
  blue: 0x5b8def,
} as const;

export const CSS = {
  bg: '#0f1114',
  panel: '#15181c',
  panelBorder: '#343b45',
  text: '#efeae0',
  textDim: '#a9adb4',
  textFaint: '#858a93',
  accent: '#ff6b3d',
  cyan: '#22d3ee',
  amber: '#f5a623',
  green: '#34d399',
  red: '#f87171',
} as const;
