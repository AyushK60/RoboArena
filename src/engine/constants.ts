// Deterministic simulation constants
export const TICK_SECONDS = 1.0; // one simulation tick = 1 simulated second
export const MOVE_TICKS = 1; // ticks to traverse one cell (constant speed, no accel)
export const PICKUP_DWELL = 3; // ticks spent loading one package
export const UNLOAD_DWELL = 6; // ticks spent unloading a full cargo at the dock
export const CELL_METERS = 2; // logical cell size, reported distance unit
export const CELL_PX = 32; // world pixels per cell (render space)
export const MAX_FLEET = 12;
export const SCHEMA_VERSION = 1;
export const PLANNING_HORIZON = 3500; // max ticks a plan may extend (must stay < 4096 for key packing)
export const MAX_LEG_EXPANSIONS = 60000; // A* node budget per leg
export const PRIORITY_ATTEMPTS = 5; // bounded priority-order retries for fleet planning
