# RoboArena — Asset credits

**All visual assets are 100% original, procedurally generated vector art created for this
project** (drawn at runtime with PixiJS Graphics into cached textures). No external images,
sprites, icons, audio, or brand assets are bundled. Only the web fonts below are fetched at runtime.

| Asset | Source | License |
|---|---|---|
| Warehouse floor, tile seams, scuffs, zone tints, safety markings, lane arrows, dock hazard stripes | `src/render/static-art.ts` — original procedural drawing | CC0 (authored for this project) |
| Shelf racks, steel frames, cartons/pallets/beams/coils/crates/bags, yellow bumpers, trucks | `src/render/static-art.ts` — original procedural drawing | CC0 (authored for this project) |
| Robot chassis (S1/H10), wheels, lidar puck, LED bars, cargo crates, ID badges, status rings | `src/render/dynamic-art.ts` — original procedural drawing | CC0 (authored for this project) |
| Route overlays, selection brackets, minimap | `src/render/dynamic-art.ts`, `src/render/warehouse-renderer.ts` | CC0 (authored for this project) |
| UI icons (cursor, tools, playback, save/export, KPI glyphs, logo mark) | `src/ui/icons.tsx` — original inline SVG | CC0 (authored for this project) |
| Typefaces | Newsreader, Geist and Geist Mono, loaded from Google Fonts at runtime (SIL Open Font License); system font fallbacks are set in `src/styles/tokens.css` |  OFL |

No real company brands (Amazon, Zomato, or others) appear anywhere in the UI. The fictional
company framing in the Overview is part of the product story, clearly labeled as simulation.
