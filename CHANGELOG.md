# Changelog

## 1.3.0
- "Plan Sheet" redesign of the landing page and studio (paper / navy / vermilion palette).
- Warehouse canvas retheme with light (paper floor plan) and dark (graphite) themes and a header toggle.
- Landing-to-studio transition animation (skipped under `prefers-reduced-motion`).
- Engine, state and scenarios unchanged.

## 1.2.1
- Replaced the landing live preview with an animated SVG warehouse schematic (one fewer WebGL context).
- Unified the studio accent colour with the landing page.

## 1.2.0
- Landing page redesign, studio token refresh, Home button, single-worker e2e runs.
- Fixed a freeze on the Steel and Construction presets caused by an invalid colour literal in the pallet drawing code.

## 1.1.0
- Fixed custom-load dispatch and stale-plan detection (fingerprint plus UI warning).
- Parking bays with return-home legs, visible inventory states, package picker, tooltips.
- Landing page, guided demo, nearest-feasible strategy and strategy Compare view.
- Responsive layout; 35 unit and 6 e2e tests.

## 1.0.0
- Deterministic engine: A*, capacity-aware allocation, space-time reservations, simulation kernel.
- Four warehouse presets, PixiJS renderer, plan / simulate / intervene / replan loop, analysis and export.
