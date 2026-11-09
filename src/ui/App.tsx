import { useSyncExternalStore, useEffect, useRef, useState } from 'react';
import { store, formatClock, GUIDED_STAGES, type AppMode } from '../state/store';
import { WarehouseRenderer } from '../render/warehouse-renderer';
import { robotColor } from '../render/dynamic-art';
import { MAP } from '../render/palette';
import { useTheme, getTheme, subscribeTheme } from './theme';
import { buildPreset } from '../scenarios/presets';
import { HeroGraphic } from './hero-graphic';
import { CELL_METERS, MAX_FLEET } from '../engine/constants';
import type { Scenario, SimSnapshot } from '../engine/types';
import {
  IconCursor, IconMove, IconRack, IconBox, IconErase, IconPan, IconPlay, IconPause, IconStep,
  IconReset, IconSkipStart, IconSave, IconExport, IconClose, IconCheck, IconAlert, IconClock,
  IconRoute, IconChart, IconBook, IconFit, IconPlus, IconMinus, IconRobot, IconShield,
  IconList, IconZoomIn, IconZoomOut, IconUndo, IconRedo, IconLogo, IconSun, IconMoon,
} from './icons';

function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Re-render at ~7 Hz - for panels that show continuously-changing sim state. */
function useLiveTick(): void {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 140);
    return () => window.clearInterval(id);
  }, []);
}

/** Live clock that re-renders ~8x per second without re-rendering the whole app. */
function LiveClock({ render }: { render: (snap: SimSnapshot) => React.ReactNode }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 120);
    return () => window.clearInterval(id);
  }, []);
  return <>{render(store.sim.snapshot(store.selectedTaskIds.size))}</>;
}

export default function App() {
  useStoreVersion();
  useTheme(); // re-render swatches / robot dots when the theme flips
  const [mobilePanel, setMobilePanel] = useState<null | 'left' | 'right'>(null);
  const togglePanel = (side: 'left' | 'right') => setMobilePanel((cur) => (cur === side ? null : side));

  // Presentation only: keep the landing mounted while it slides away, then play the studio entrance.
  const [landing, setLanding] = useState<'on' | 'leaving' | 'off'>(store.mode === 'overview' ? 'on' : 'off');
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    if (store.mode === 'overview') {
      setLanding('on');
      setEntering(false);
      return;
    }
    if (landing !== 'on') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLanding('off');
      return;
    }
    setLanding('leaving');
    setEntering(true);
    const t1 = window.setTimeout(() => setLanding('off'), 800);
    const t2 = window.setTimeout(() => setEntering(false), 1700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.mode]);
  const showLanding = store.mode === 'overview' || landing !== 'off';

  return (
    <div className={`app ${mobilePanel ? `panel-open-${mobilePanel}` : ''} ${entering ? 'app-entering' : ''}`}>
      <TopBar onTogglePanel={togglePanel} />
      <div className="main">
        <LeftPanel />
        <CanvasHost />
        <RightPanel />
      </div>
      <BottomBar />
      {showLanding && <LandingPage leaving={store.mode !== 'overview'} />}
      {store.guidedStep >= 0 && <GuidedOverlay />}
      {store.mode === 'overview' && <style>{`.main > .left-panel, .main > .right-panel, .bottombar { visibility: hidden; } .landing ~ * { }`}</style>}
      {store.learnOpen && <LearnPanel />}
      <ToastHost />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- TopBar
function TopBar({ onTogglePanel }: { onTogglePanel: (side: 'left' | 'right') => void }) {
  const mode = store.mode;
  const [theme, toggleTheme] = useTheme();
  const tabs: { id: AppMode; label: string; icon: React.ReactNode }[] = [
    { id: 'design', label: 'Design', icon: <IconRack /> },
    { id: 'plan', label: 'Plan', icon: <IconList /> },
    { id: 'simulate', label: 'Simulate', icon: <IconPlay /> },
    { id: 'analyze', label: 'Analyze', icon: <IconChart /> },
    { id: 'compare', label: 'Compare', icon: <IconChart /> },
  ];
  return (
    <header className="topbar">
      <button className="brand brand-home" onClick={() => store.setMode('overview')} aria-label="RoboArena home" title="Back to home">
        <IconLogo />
        <div>
          <div className="brand-name">Robo<span className="accent">Arena</span></div>
          <div className="brand-sub">Warehouse Robotics Simulation Studio</div>
        </div>
      </button>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${mode === t.id ? 'active' : ''}`} onClick={() => store.setMode(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <button className={`tab ${store.learnOpen ? 'active' : ''}`} onClick={() => { store.learnOpen = !store.learnOpen; store.notify(); }}>
          <IconBook /><span>Learn</span>
        </button>
      </nav>
      <div className="mobile-toggles">
        <button className="btn small" onClick={() => onTogglePanel('left')} aria-label="Toggle tools">Tools</button>
        <button className="btn small" onClick={() => onTogglePanel('right')} aria-label="Toggle mission panel">Mission</button>
      </div>
      <div className="topbar-right">
        <select
          className="preset-select"
          value={store.activePresetId}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('custom:')) store.loadCustom(v.slice('custom:'.length));
            else store.loadPreset(v);
          }}
          aria-label="Warehouse preset"
        >
          {store.presetList.map((p) => (
            <option key={p.id} value={p.id}>{p.name} - {p.subtitle}</option>
          ))}
          {store.listCustoms().map((c) => (
            <option key={c.id} value={`custom:${c.id}`}>{c.name} (saved)</option>
          ))}
        </select>
        <button className="btn" onClick={() => {
          const name = window.prompt('Save current layout as:', `${store.scenario.map.name} (custom)`);
          if (name) store.saveCustom(name);
        }}>
          <IconSave /><span>Save</span>
        </button>
        <button className="btn" onClick={() => document.getElementById('import-file')?.click()}>
          <IconExport /><span>Import</span>
        </button>
        <button
          className="btn theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then((t) => store.importScenarioFile(t));
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- Canvas
// One renderer per page lifetime - React StrictMode remounts must not create a second
// PixiJS application on the same canvas.
let rendererSingleton: WarehouseRenderer | null = null;

function CanvasHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !hostRef.current) return;
    if (!rendererSingleton) {
      rendererSingleton = new WarehouseRenderer(canvasRef.current, {
        onCellClick: (cell, shift) => store.onCellClick(cell, shift),
      });
    }
    const r = rendererSingleton;
    store.renderer = {
      setScenario: (s) => r.setScenario(s),
      setPlan: (p) => r.setPlan(p),
      setSnapshot: (s, t) => r.setSnapshot(s, t),
      setSelectedRobot: (id) => r.setSelectedRobot(id),
      fitToMap: () => r.fitToMap(),
      setTool: (t, e) => r.setTool(t, e),
      setSelectedTasks: (ids, hoverId) => r.setSelectedTasks(ids, hoverId),
      setLandingDrift: (on) => r.setLandingDrift(on),
      raw: r,
    };
    r.setScenario(store.scenario);
    r.setTheme(getTheme());
    const offTheme = subscribeTheme(() => r.setTheme(getTheme()));
    requestAnimationFrame(() => r.fitToMap());
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      offTheme();
    };
  }, []);
  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas ref={canvasRef} className="warehouse-canvas" aria-label="Warehouse top-down view" />
      <div className="canvas-tools">
        <button className="canvas-tool" title="Fit to map" onClick={() => store.renderer?.fitToMap()}><IconFit /></button>
        <button className="canvas-tool" title="Zoom in" onClick={() => zoomBy(1.25)}><IconPlus /></button>
        <button className="canvas-tool" title="Zoom out" onClick={() => zoomBy(0.8)}><IconMinus /></button>
      </div>
      <div className="map-caption" key={store.scenario.map.id}>
        <span>{store.scenario.map.name}</span>
        <span className="dim"> · {store.scenario.map.width}×{store.scenario.map.height} cells · {store.scenario.packages.length} packages · {store.scenario.robots.length} robots · 1 cell = {CELL_METERS} m</span>
      </div>
    </div>
  );
}

function zoomBy(f: number): void {
  // renderer zoom via wheel simulation is internal; expose simple API through fit/zoom state
  void f;
}

// ---------------------------------------------------------------- LeftPanel
// Mirrors the canvas: robot colour identity by class (S1 = cyan family, H10 = amber family).
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
function robotCss(id: string, type?: 'S1' | 'H10'): string {
  const t = type ?? store.scenario.robots.find((r) => r.id === id)?.type;
  return `#${robotColor(id, t).toString(16).padStart(6, '0')}`;
}

function LeftPanel() {
  const mode = store.mode;
  return (
    <aside className="left-panel">
      {mode === 'design' && <DesignTools />}
      {mode === 'plan' && <PlanTools />}
      {mode === 'simulate' && <SimulateTools />}
      {mode === 'analyze' && <AnalyzeSide />}
      {mode === 'compare' && <AnalyzeSide />}
      {mode === 'overview' && <DesignTools />}
    </aside>
  );
}

function DesignTools() {
  const tools: { id: typeof store.tool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Select', icon: <IconCursor /> },
    { id: 'move', label: 'Move pkg', icon: <IconMove /> },
    { id: 'package', label: 'Add pkg', icon: <IconBox /> },
    { id: 'rack', label: 'Rack', icon: <IconRack /> },
    { id: 'erase', label: 'Clear', icon: <IconErase /> },
    { id: 'home', label: 'Set home', icon: <IconRobot /> },
    { id: 'pan', label: 'Pan', icon: <IconPan /> },
  ];
  const errors = store.validation.filter((v) => v.level === 'error');
  const warns = store.validation.filter((v) => v.level === 'warning');
  return (
    <>
      <Section title="Edit">
        <div className="tool-grid">
          {tools.map((t) => (
            <button key={t.id} className={`tool ${store.tool === t.id ? 'active' : ''}`} onClick={() => { store.tool = t.id; store.notify(); }} title={t.label}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn small" onClick={() => store.undo()}><IconUndo /> Undo</button>
          <button className="btn small" onClick={() => store.redo()}><IconRedo /> Redo</button>
        </div>
        {store.tool === 'home' && (
          <div className="home-picker">
            <span className="dim">Parking bay for:</span>
            <select
              value={store.homeToolRobotId ?? store.scenario.robots[0]?.id ?? ''}
              onChange={(e) => { store.homeToolRobotId = e.target.value; store.notify(); }}
            >
              {store.scenario.robots.map((r) => (
                <option key={r.id} value={r.id}>{r.id} ({r.type})</option>
              ))}
            </select>
          </div>
        )}
      </Section>
      <Section title="Validation">
        {errors.length === 0 && warns.length === 0 && (
          <div className="status ok"><IconCheck /> Map valid - mission ready</div>
        )}
        {errors.map((v, i) => <div key={i} className="status err"><IconAlert /> {v.message}</div>)}
        {warns.map((v, i) => <div key={i} className="status warn"><IconAlert /> {v.message}</div>)}
      </Section>
      <Section title="Robots">
        {store.scenario.robots.map((r) => (
          <div key={r.id} className="robot-row">
            <span className="robot-dot" style={{ background: robotCss(r.id) }} data-type={r.type} />
            <span className="mono">{r.id}</span>
            <span className="dim">{r.type} · cap {r.capacity}</span>
          </div>
        ))}
      </Section>
      <Section title="Legend">
        <div className="legend">
          <span><i className="sw" style={{ background: hex(MAP.zoneTints.receiving) }} /> Receiving / Shipping</span>
          <span><i className="sw" style={{ background: hex(MAP.zoneTints.packing) }} /> Packing</span>
          <span><i className="sw" style={{ background: hex(MAP.zoneTints.charging) }} /> Charging</span>
          <span><i className="sw" style={{ background: hex(MAP.zoneTints.restricted) }} /> Restricted</span>
          <span><i className="sw" style={{ background: hex(MAP.safety) }} /> Rack bumpers</span>
        </div>
      </Section>
    </>
  );
}

function PlanTools() {
  const n = store.selectedTaskIds.size;
  return (
    <>
      <Section title="Mission">
        <div className="kpi-row">
          <div className="kpi"><b>{n}</b><span>of {store.scenario.packages.length} selected</span></div>
          <div className="kpi"><b>{store.selectedRobotIds.size}</b><span>robots active</span></div>
        </div>
        <button className="btn primary wide" onClick={() => store.selectSampleMission(15)}>Sample: 15 of {store.scenario.packages.length}</button>
        <button className="btn wide" onClick={() => store.clearTaskSelection()}>Clear selection</button>
        <button className="btn primary wide" onClick={() => store.planMission()} disabled={n === 0}>
          <IconRoute /> Compute plan
        </button>
        <p className="hint">Tip: click numbered packages on the map to add or remove them from the mission.</p>
        <h4 className="sub-head">Assignment strategy</h4>
        <div className="algo-card clickable" onClick={() => store.setStrategy('insertion')}>
          <span className={`radio ${store.strategy === 'insertion' ? 'on' : ''}`} />
          <div><b>Fleet optimization</b><div className="dim">capacity-aware insertion · makespan bidding</div></div>
        </div>
        <div className="algo-card clickable" onClick={() => store.setStrategy('nearest')}>
          <span className={`radio ${store.strategy === 'nearest' ? 'on' : ''}`} />
          <div><b>Greedy nearest-feasible</b><div className="dim">simple baseline · nearest pickup first</div></div>
        </div>
      </Section>
      <Section title="Fleet">
        {store.scenario.robots.map((r) => (
          <label key={r.id} className="check-row">
            <input
              type="checkbox"
              checked={store.selectedRobotIds.has(r.id)}
              onChange={() => store.toggleRobot(r.id)}
            />
            <span className="robot-dot" style={{ background: robotCss(r.id) }} data-type={r.type} />
            <span className="mono">{r.id}</span>
            <span className="dim">{r.type} · cap {r.capacity}</span>
          </label>
        ))}
        <div className="row">
          <button className="btn small" onClick={() => store.setFleetSize(1)}>1</button>
          <button className="btn small" onClick={() => store.setFleetSize(2)}>2</button>
          <button className="btn small" onClick={() => store.setFleetSize(4)}>4</button>
          <button className="btn small" onClick={() => store.setFleetSize(Math.min(MAX_FLEET, store.scenario.robots.length))}>All</button>
        </div>
      </Section>
    </>
  );
}

function SimulateTools() {
  useLiveTick();
  const snap = store.sim.snapshot(store.selectedTaskIds.size);
  const paused = !store.playing;
  return (
    <>
      <Section title="Intervene (while paused)">
        <div className="tool-grid">
          <button className={`tool ${store.tool === 'move' ? 'active' : ''}`} onClick={() => { store.tool = 'move'; store.notify(); }}>
            <IconMove /><span>Move pkg</span>
          </button>
          <button className={`tool ${store.tool === 'rack' ? 'active' : ''}`} onClick={() => { store.tool = 'rack'; store.notify(); }}>
            <IconRack /><span>Block aisle</span>
          </button>
          <button className={`tool ${store.tool === 'erase' ? 'active' : ''}`} onClick={() => { store.tool = 'erase'; store.notify(); }}>
            <IconErase /><span>Open aisle</span>
          </button>
          <button className="tool" onClick={() => { store.tool = 'select'; store.notify(); }}>
            <IconCursor /><span>Select</span>
          </button>
        </div>
        {!paused && <p className="hint warn-hint">Pause the simulation to edit safely. Edits validate and replan from current positions.</p>}
        {paused && store.planOutcome && <p className="hint">Tools armed - map edits will validate, then replan remaining tasks.</p>}
      </Section>
      <Section title="Fleet status">
        {snap.robots.map((r) => (
          <button key={r.id} className={`robot-card ${store.focusRobotId === r.id ? 'focused' : ''}`} onClick={() => store.focusRobot(store.focusRobotId === r.id ? null : r.id)}>
            <span className="robot-dot" style={{ background: robotCss(r.id) }} data-type={r.type} />
            <span className="mono">{r.id}</span>
            <span className={`state st-${r.state}`}>{r.state}</span>
            <span className="dim">carrying {r.cargo.length}/{r.capacity} · {r.deliveriesDone} delivered · {r.tripsCompleted} trips</span>
          </button>
        ))}
      </Section>
    </>
  );
}

function AnalyzeSide() {
  return (
    <>
      <Section title="Exports">
        <button className="btn wide" onClick={() => store.exportRunJson()}><IconExport /> Export run JSON</button>
        <button className="btn wide" onClick={() => store.exportRunCsv()}><IconExport /> Export metrics CSV</button>
      </Section>
      <Section title="About the data">
        <p className="hint">
          All numbers come from the deterministic engine - the same scenario, selection and fleet
          always replay identically. Distances are simulated meters (1 cell = {CELL_METERS} m);
          planning time is real CPU time on this machine.
        </p>
      </Section>
      <Section title="Roadmap (V2)">
        <p className="hint">
          Comparing alternative planning algorithms (nearest-neighbor, auction, exact baselines)
          arrives in Version 2 behind the same PlanningStrategy interface. No fake comparisons here.
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- RightPanel
function RightPanel() {
  const mode = store.mode;
  return (
    <aside className="right-panel">
      {mode === 'analyze' ? <AnalyzePanel /> : mode === 'compare' ? <ComparePanel /> : <MissionPlanner />}
    </aside>
  );
}

function ComparePanel() {
  const cmp = store.comparison;
  const rows = cmp?.rows ?? [];
  const sameScenario = cmp && cmp.scenarioId === store.scenario.id && cmp.tasks === store.selectedTaskIds.size;
  return (
    <>
      <div className="panel-head">
        <IconChart />
        <h3>Compare strategies</h3>
      </div>
      <div className="panel-body">
        <p className="hint">
          Both planners receive the <b>identical</b> scenario, selected packages, fleet and time
          model; only the assignment strategy differs. Movement uses the same space-time
          reservations for both. Makespan = last delivery; the last park is reported separately.
        </p>
        <button className="btn primary wide" onClick={() => store.runComparison()} disabled={store.selectedTaskIds.size === 0}>
          <IconPlay /> Run comparison ({store.selectedTaskIds.size} tasks · {store.selectedRobotIds.size} robots)
        </button>
        {cmp && sameScenario && (
          <div className="cmp-table">
            <div className="cmp-row cmp-head">
              <span>Metric</span>
              {rows.map((r) => <b key={r.key}>{r.key === 'insertion' ? 'Insertion' : 'Nearest'}</b>)}
            </div>
            {([
              ['Delivered', (r) => `${r.delivered}/${r.selected}`],
              ['Failed robots', (r) => String(r.failed)],
              ['Actual makespan', (r) => (r.actualMakespan !== null ? formatClock(r.actualMakespan) : '-')],
              ['Planned makespan', (r) => (r.plannedMakespan !== null ? formatClock(r.plannedMakespan) : '-')],
              ['Last park', (r) => (r.lastParked !== null ? formatClock(r.lastParked) : '-')],
              ['Distance', (r) => `${r.distanceMeters.toFixed(0)} m`],
              ['Dock trips', (r) => String(r.trips)],
              ['Planned waits', (r) => String(r.conflicts)],
              ['Planning time', (r) => `${r.planningMs.toFixed(1)} ms`],
            ] as [string, (r: (typeof rows)[number]) => string][]).map(([label, fn]) => (
              <div className="cmp-row" key={label}>
                <span className="dim">{label}</span>
                {rows.map((r) => <span key={r.key} className="mono">{fn(r)}</span>)}
              </div>
            ))}
            <div className="cmp-row cmp-head">
              <span>Per-robot workload</span>
              {rows.map((r) => <b key={r.key}> </b>)}
            </div>
            {rows[0]?.perRobot.map((pr, i) => (
              <div className="cmp-row" key={pr.id}>
                <span className="dim mono">{pr.id}</span>
                {rows.map((r) => (
                  <span key={r.key} className="mono">
                    {r.perRobot[i] ? `${r.perRobot[i].delivered} delivered · ${r.perRobot[i].trips} trips` : '-'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        {cmp && !sameScenario && (
          <p className="hint warn-hint">This comparison is from a different scenario or selection - run it again.</p>
        )}
        <p className="hint">
          Both strategies are heuristics. Neither is globally optimal; a better measured makespan on
          one scenario is not a general ranking.
        </p>
      </div>
    </>
  );
}

function MissionPlanner() {
  const selected = [...store.selectedTaskIds].sort();
  const snap = store.sim.snapshot(store.selectedTaskIds.size);
  const summary = store.planSummary;
  const stale = store.isPlanStale();
  const started = store.sim.currentTick > 0;
  return (
    <>
      <div className="panel-head">
        <IconList />
        <h3>Mission Planner</h3>
      </div>
      <div className="panel-body">
        {stale && (
          <div className="stale-banner" role="status">
            <IconAlert />
            <div>
              <b>Plan needs updating</b>
              <div className="dim">
                Selection, fleet or map changed after this plan was computed.{' '}
                {started
                  ? 'The paused run keeps its old route until you choose:'
                  : 'Start/step are disabled until you recompute.'}
              </div>
              <div className="row">
                <button className="btn small" onClick={() => { store.resetMission(); store.planMission(); }}>
                  Recompute from start
                </button>
                {started && (
                  <button className="btn small" onClick={() => store.replanFromCurrentState('Manual replan.')}>
                    Replan from current
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="kpi-row">
          <div className="kpi"><b>{selected.length}</b><span>of {store.scenario.packages.length} selected orders</span></div>
          <div className="kpi"><b>{store.selectedRobotIds.size}</b><span>robots in fleet</span></div>
        </div>
        <PackagePicker selectedIds={new Set(selected)} snap={snap} />

        {summary && (
          <>
            <h4 className="sub-head">Task Assignment</h4>
            {Object.entries(summary.tripsByRobot).map(([robotId, trips]) => (
              <div key={robotId} className="assign-card">
                <div className="assign-head">
                  <span className="robot-dot" style={{ background: robotCss(robotId) }} />
                  <b className="mono">{robotId}</b>
                  <span className="dim">{trips.length} trip{trips.length > 1 ? 's' : ''} · {trips.reduce((n, t) => n + t.taskIds.length, 0)} tasks</span>
                </div>
                <div className="assign-trips">
                  {trips.map((t, i) => (
                    <div key={i} className="trip-row">
                      <span className="trip-n">T{i + 1}</span>
                      <span>{t.taskIds.map((x) => x.replace('P-', '')).join(' → ') || '-'} → dock</span>
                    </div>
                  ))}
                </div>
                <p className="hint">{summary.assignmentNotes[robotId]}</p>
                {summary.failedRobots.some((f) => f.robotId === robotId) && (
                  <p className="status err"><IconAlert /> {summary.failedRobots.find((f) => f.robotId === robotId)?.reason}</p>
                )}
              </div>
            ))}
            <h4 className="sub-head">Planning Algorithm</h4>
            <div className="algo-card selected">
              <span className="radio on" /> <div><b>{summary.strategyName}</b><div className="dim">deterministic heuristic - not proven optimal</div></div>
            </div>
            <p className="hint">Estimated makespan <b>{formatClock(summary.estimatedMakespanTicks)}</b> · planning took {summary.planningMs.toFixed(0)} ms.</p>
          </>
        )}

        {store.mode === 'plan' && (
          <button
            className="btn primary wide big"
            onClick={() => (!store.planOutcome || store.isPlanStale() ? store.planMission() : store.play())}
            disabled={selected.length === 0}
          >
            <IconPlay /> {!store.planOutcome || store.isPlanStale() ? 'Compute plan' : 'Run simulation'}
          </button>
        )}
        {store.mode === 'simulate' && store.planOutcome && !store.playing && !stale && store.sim.status !== 'finished' && (
          <button className="btn primary wide big" onClick={() => store.play()}><IconPlay /> Resume</button>
        )}
      </div>
    </>
  );
}

function PackagePicker({ selectedIds, snap }: { selectedIds: Set<string>; snap: SimSnapshot }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'selected' | 'all'>('selected');
  const q = query.trim().toLowerCase();
  const all = store.scenario.packages;
  const matches = all.filter((p) => {
    const hit = !q || p.id.toLowerCase().includes(q) || p.aisleLabel.toLowerCase().includes(q) || p.shelfLabel.toLowerCase().includes(q) || p.shape.includes(q);
    return hit && (mode === 'all' || selectedIds.has(p.id));
  });
  return (
    <div className="pkg-picker">
      <div className="pkg-tools">
        <input
          className="search"
          placeholder="Search ID, aisle, shelf, shape…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search packages"
        />
        <div className="seg">
          <button className={mode === 'selected' ? 'on' : ''} onClick={() => setMode('selected')}>
            Mission ({selectedIds.size})
          </button>
          <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
            All ({all.length})
          </button>
        </div>
      </div>
      <div className="pkg-list" role="listbox" aria-label="Packages">
        {matches.slice(0, 60).map((p) => {
          const st = snap.packageStates[p.id];
          const isSel = selectedIds.has(p.id);
          return (
            <button
              key={p.id}
              className={`pkg-row ${isSel ? 'sel' : ''}`}
              role="option"
              aria-selected={isSel}
              onMouseEnter={() => store.setHoveredPackage(p.id)}
              onMouseLeave={() => store.setHoveredPackage(null)}
              onClick={() => store.toggleTask(p.id)}
            >
              <span className={`chip ${isSel ? 'on' : ''}`}>{p.id.replace('P-', '')}</span>
              <span>{p.aisleLabel}</span>
              <span className="dim">{p.shelfLabel} · {p.shape}</span>
              <span className={`state st-${st === 'delivered' ? 'done' : st === 'carried' ? 'pickingUp' : isSel ? 'assigned' : 'idle'}`}>{st}</span>
            </button>
          );
        })}
        {matches.length > 60 && <div className="dim more">+ {matches.length - 60} more - refine the search</div>}
        {matches.length === 0 && <div className="dim more">No packages match.</div>}
      </div>
      {mode === 'all' && (
        <div className="row">
          <button className="btn small" onClick={() => { matches.forEach((p) => { if (!selectedIds.has(p.id)) store.toggleTask(p.id); }); }}>
            Select all shown
          </button>
          <button className="btn small" onClick={() => store.clearTaskSelection()}>Clear</button>
        </div>
      )}
    </div>
  );
}

function AnalyzePanel() {
  const snap = store.sim.snapshot(store.selectedTaskIds.size);
  const m = snap.metrics;
  const maxDist = Math.max(1, ...Object.values(m.perRobot).map((r) => r.distanceMeters));
  return (
    <>
      <div className="panel-head">
        <IconChart />
        <h3>Analysis</h3>
      </div>
      <div className="panel-body">
        <div className="kpi-grid">
          <div className="kpi-card"><span>Delivered</span><b>{m.delivered} / {m.selected}</b></div>
          <div className="kpi-card"><span>Actual makespan</span><b>{m.actualMakespanTicks !== null ? formatClock(m.actualMakespanTicks) : '-'}</b></div>
          <div className="kpi-card"><span>Planned makespan</span><b>{m.plannedMakespanTicks !== null ? formatClock(m.plannedMakespanTicks) : '-'}</b></div>
          <div className="kpi-card"><span>Distance travelled</span><b>{m.distanceMeters.toFixed(0)} m</b></div>
          <div className="kpi-card"><span>Waiting (ticks)</span><b>{m.waitTicks}</b></div>
          <div className="kpi-card"><span>Planned waits (conflicts avoided)</span><b>{m.conflictsAvoided}</b></div>
          <div className="kpi-card"><span>Planning time</span><b>{m.planningMs.toFixed(0)} ms</b></div>
          <div className="kpi-card"><span>Dock trips</span><b>{m.trips}</b></div>
        </div>
        <h4 className="sub-head">Per robot</h4>
        {Object.entries(m.perRobot).map(([id, r]) => (
          <div key={id} className="meter">
            <div className="meter-head">
              <b className="mono">{id}</b>
              <span className="dim">{r.delivered} delivered · {r.trips} trips · {r.distanceMeters} m · wait {r.waitTicks} t</span>
            </div>
            <div className="meter-bar"><div style={{ width: `${(r.distanceMeters / maxDist) * 100}%` }} /></div>
          </div>
        ))}
        <h4 className="sub-head">Event timeline (executed: {snap.events.filter((e) => e.tick <= snap.tick).length})</h4>
        <div className="event-list">
          {[...snap.events].filter((e) => e.tick <= snap.tick).reverse().slice(0, 60).map((e, i) => (
            <div key={i} className={`event ev-${e.kind}`}>
              <span className="ev-t mono">{formatClock(e.tick)}</span>
              <span>{e.message}</span>
            </div>
          ))}
          {snap.events.length === 0 && <p className="hint">No events yet - run a mission.</p>}
        </div>
        <p className="hint">
          Planned vs actual makespan differ because the estimator ignores congestion waits; the
          space-time planner then resolves real conflicts. Heuristic allocation - no global-optimality claim.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- BottomBar
function BottomBar() {
  return (
    <footer className="bottombar">
      <LiveClock
        render={(snap) => {
          const stale = store.isPlanStale();
          const total = snap.metrics.plannedMakespanTicks ?? Math.max(60, snap.tick);
          const pct = Math.min(100, (snap.tick / Math.max(1, total)) * 100);
          return (
            <>
              {stale && <span className="stale-chip" role="status">Plan needs updating</span>}
              <div className="clock-block">
                <div className="clock-line">
                  <IconClock />
                  <b className="mono">{formatClock(snap.tick)}</b>
                  <span className="dim">/ est {formatClock(total)}</span>
                </div>
                <div className="progress"><div style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="controls">
                <button className="ctl" title="Reset" onClick={() => store.resetMission()}><IconReset /></button>
                <button className="ctl" title="Single tick" disabled={stale} onClick={() => store.step(1)}><IconStep /></button>
                <button className="ctl primary" title={stale ? 'Plan needs updating' : store.playing ? 'Pause' : 'Run'} disabled={stale} onClick={() => (store.playing ? store.pause() : store.play())}>
                  {store.playing ? <IconPause /> : <IconPlay />}
                </button>
                <select className="speed" value={store.speed} onChange={(e) => store.setSpeed(Number(e.target.value))} aria-label="Playback speed">
                  {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </div>
              <div className="kpis">
                <Kpi icon={<IconCheck />} label="Jobs completed" value={`${snap.metrics.delivered} / ${snap.metrics.selected || store.selectedTaskIds.size}`} tone="green" />
                <Kpi icon={<IconClock />} label="Fleet makespan" value={snap.metrics.actualMakespanTicks !== null ? formatClock(snap.metrics.actualMakespanTicks) : (snap.metrics.plannedMakespanTicks !== null ? `est ${formatClock(snap.metrics.plannedMakespanTicks)}` : '-')} tone="amber" />
                <Kpi icon={<IconRoute />} label="Distance travelled" value={`${snap.metrics.distanceMeters.toFixed(1)} m`} tone="cyan" />
                <Kpi icon={<IconShield />} label="Conflicts avoided" value={String(snap.metrics.conflictsAvoided)} tone="amber" />
              </div>
            </>
          );
        }}
      />
    </footer>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className={`kpi-block tone-${tone}`}>
      <span className="kpi-icon">{icon}</span>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value mono">{value}</div>
      </div>
    </div>
  );
}

const previewCache = new Map<string, Scenario>();
function previewScenario(id: string): Scenario {
  let sc = previewCache.get(id);
  if (!sc) {
    sc = buildPreset(id);
    previewCache.set(id, sc);
  }
  return sc;
}

// ---------------------------------------------------------------- Landing (v1.3, "drawing sheet")
function LandingPage({ leaving = false }: { leaving?: boolean }) {
  const presets = store.presetList;
  const [showTech, setShowTech] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const presetDescriptions: Record<string, string> = {
    ecommerce: 'Dense carton aisles with receiving, packing and shipping docks - the classic fulfillment floor.',
    steel: 'Wide aisles, coils and beams in a heavy-goods depot with long horizontal bays.',
    construction: 'Pallets, bags and timber across mixed-material zones and a guarded restricted strip.',
    crossdock: 'Sorting racks, staging lanes and a dispatch wall - flow from receiving straight out.',
  };

  // Scroll reveal: sections fade up once. Armed only after mount, so content is never hidden without JS.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(root.querySelectorAll('.reveal'));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { root, threshold: 0.15 },
    );
    root.classList.add('js-reveal');
    items.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove('js-reveal');
    };
  }, []);

  return (
    <div className={`lp ${leaving ? 'lp-leaving' : ''}`} ref={rootRef}>
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <div className="lp-brand">
            <IconLogo />
            <span className="lp-wordmark">Robo<span className="lp-accent">Arena</span></span>
            <span className="lp-ver">v1.2</span>
          </div>
          <nav className="lp-nav" aria-label="Site">
            <button className="lp-navlink" onClick={() => { store.learnOpen = true; store.notify(); }}>Learn</button>
            <button className="lp-navlink lp-navcta" onClick={() => { store.setMode('design'); }}>Studio</button>
          </nav>
        </div>
      </header>

      <section className="lp-wrap lp-hero">
        <div className="lp-kicker">Warehouse robotics simulation studio</div>
        <h1>
          <span className="lp-line"><span>Plan the work.</span></span>
          <span className="lp-line"><span>Watch the floor <em>deliver</em>.</span></span>
        </h1>
        <div className="lp-hero-row">
          <p className="lp-lede">
            RoboArena shows how a robot fleet thinks. Pick orders from a real warehouse, dispatch
            Scout and Hauler robots, and watch a planning algorithm assign every task, route through
            aisles, wait its turn and deliver - then edit the building and watch the plan adapt.
          </p>
          <div className="lp-hero-actions">
            <div className="lp-ctas">
              <button className="lp-cta-primary" onClick={() => { store.setMode('simulate'); store.startGuidedDemo(); }}>
                Start a guided mission
              </button>
              <button className="lp-cta-secondary" onClick={() => store.setMode('design')}>
                Explore a warehouse
              </button>
            </div>
            <p className="lp-trust">
              Runs entirely in your browser · deterministic replays · heuristics, honestly labeled
            </p>
          </div>
        </div>
        <figure className="lp-hero-visual">
          <div className="lp-frame t-dark">
            <HeroGraphic />
            <div className="lp-legend" aria-hidden="true">
              <div><span className="lp-sw lp-sw-a" />Scout S1<b>1 package per trip</b></div>
              <div><span className="lp-sw lp-sw-b" />Hauler H10<b>Up to 10 per trip</b></div>
              <div>Scale<b>1 cell = {CELL_METERS} m</b></div>
              <div>Sheet 01<b>Fleet schematic · rev 1.2</b></div>
            </div>
          </div>
          <figcaption className="lp-hero-caption">
            One plan, two robots, zero collisions - routes are computed through real aisles and
            reserved second by second. <button className="lp-link" onClick={() => { store.setMode('simulate'); store.startGuidedDemo(); }}>See it run</button>
          </figcaption>
        </figure>
      </section>

      <section className="lp-wrap lp-flow" aria-label="How it works">
        <div className="reveal">
          <div className="lp-section-label"><i>01</i> How it works</div>
          <ol className="lp-flow-steps">
            {[
              ['Design', 'Edit racks, inventory and parking bays on a live map.'],
              ['Assign', 'Choose orders and a Scout/Hauler fleet that fits the job.'],
              ['Plan', 'Compare two assignment strategies before anything moves.'],
              ['Simulate', 'Watch picks, waits, deliveries and returns tick by tick.'],
              ['Analyze', 'Makespan, distance, waits - export the run as JSON/CSV.'],
            ].map(([t, d], i) => (
              <li key={t} className="lp-step">
                <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
                <b>{t}</b>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-wrap lp-warehouses" aria-label="Warehouse presets">
        <div className="reveal">
          <div className="lp-section-label"><i>02</i> Four warehouses, four different problems</div>
          <div className="lp-wgrid">
            {presets.map((p, i) => {
              const sc = previewScenario(p.id);
              return (
                <button key={p.id} className="lp-wcard" onClick={() => { store.loadPreset(p.id); store.setMode('plan'); }}>
                  <span className="lp-wcard-n mono">{String(i + 1).padStart(2, '0')}</span>
                  <div className="lp-wcard-head">
                    <b>{p.name}</b>
                    <span className="lp-wcard-arrow" aria-hidden>→</span>
                  </div>
                  <p>{presetDescriptions[p.id]}</p>
                  <span className="lp-wcard-stats mono">
                    {sc.packages.length} packages · {sc.robots.length} robots<br />{sc.map.width}×{sc.map.height} cells
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="lp-wrap lp-notes">
        <div className="lp-notes-col reveal">
          <div className="lp-section-label"><i>03</i> What you'll notice</div>
          <ul className="lp-observations">
            <li>
              <b>Assignment has reasons.</b> The Hauler takes multi-stop trips while the Scout runs
              singles - the planner tests each option against the predicted finish time and shows its
              reasoning per robot.
            </li>
            <li>
              <b>Waiting is part of the design.</b> When two routes would cross, a robot holds
              position - reservations, not collisions. Amber pause markers appear on the route.
            </li>
            <li>
              <b>Replays are exact.</b> Reset and rerun the same mission: every pickup, wait and
              delivery repeats identically. Experiments are trustworthy because the clock is deterministic.
            </li>
          </ul>
        </div>
        <div className="lp-notes-col lp-notes-limit t-dark reveal">
          <div className="lp-section-label"><i>04</i> Honest limits</div>
          <p>
            Both planners are fast heuristics - not proven optimal. The reservation planner can
            report a genuine failure in tight congestion rather than fake a route. Nothing here
            controls real robots; all data is simulated.{' '}
            <button className="lp-link" onClick={() => { store.learnOpen = true; store.notify(); }}>
              Read the algorithm guide
            </button>
          </p>
          <button className="lp-tech-toggle" onClick={() => setShowTech(!showTech)} aria-expanded={showTech}>
            {showTech ? '− Hide engineering notes' : '+ Engineering notes'}
          </button>
          {showTech && (
            <div className="lp-tech">
              <p><b>Routing</b> A* on the aisle graph, Manhattan heuristic, BFS-verified shortest paths.</p>
              <p><b>Allocation</b> Capacity-aware insertion scored by predicted makespan over true aisle distances; nearest-feasible baseline for comparison.</p>
              <p><b>Safety</b> Prioritized space-time A* with cell/edge reservations and wait actions.</p>
              <p><b>Determinism</b> Integer-tick core; the renderer only interpolates.</p>
            </div>
          )}
        </div>
      </section>

      <footer className="lp-footer t-dark">
        <div className="lp-wrap lp-footer-in">
          <span>
            A simulation project by Ayush Khanal. Results are synthetic, not real factory data.
          </span>
          <button className="lp-link" onClick={() => store.setMode('design')}>Open the studio →</button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- Guided demo
function GuidedOverlay() {
  const step = store.guidedStep;
  if (step < 0 || !GUIDED_STAGES[step]) return null;
  const stage = GUIDED_STAGES[step];
  const snap = store.sim.snapshot(store.selectedTaskIds.size);
  const finished = snap.status === 'finished';
  return (
    <div className="guided" role="complementary" aria-label="Guided mission">
      <div className="guided-head">
        <span className="guided-tag">GUIDED MISSION</span>
        <div className="guided-dots">
          {GUIDED_STAGES.map((g, i) => (
            <span key={g.id} className={`dot ${i < step ? 'done' : i === step ? 'now' : ''}`} />
          ))}
        </div>
        <button className="guided-x" onClick={() => store.exitGuidedDemo()} aria-label="Exit guided mission"><IconClose /></button>
      </div>
      <h4>{stage.title}</h4>
      <p>{stage.text(store)}</p>
      <div className="guided-actions">
        {store.playing ? (
          <button className="btn small" onClick={() => store.pause()}><IconPause /> Pause</button>
        ) : (
          <button className="btn small" onClick={() => store.play()} disabled={store.isPlanStale() || finished}><IconPlay /> Resume</button>
        )}
        {step < GUIDED_STAGES.length - 1 && (
          <button className="btn small" onClick={() => store.guidedNext()}>Next stage</button>
        )}
        <button className="btn small" onClick={() => { store.resetMission(); store.planMission(); store.play(); }}>
          <IconReset /> Replay
        </button>
      </div>
      {finished && step === GUIDED_STAGES.length - 1 && (
        <div className="guided-done"><IconCheck /> Mission complete - explore Analyze for the full breakdown.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Learn
function LearnPanel() {
  const [level, setLevel] = useState<'simple' | 'engineering'>('simple');
  return (
    <div className="overlay" onClick={() => { store.learnOpen = false; store.notify(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <IconBook />
          <h2>How RoboArena decides</h2>
          <div className="seg">
            <button className={level === 'simple' ? 'on' : ''} onClick={() => setLevel('simple')}>Simple</button>
            <button className={level === 'engineering' ? 'on' : ''} onClick={() => setLevel('engineering')}>Engineering</button>
          </div>
          <button className="ctl" onClick={() => { store.learnOpen = false; store.notify(); }}><IconClose /></button>
        </div>
        <div className="modal-body">
          <LearnA level={level} />
          <LearnB level={level} />
          <LearnC level={level} />
          <LearnD level={level} />
        </div>
      </div>
    </div>
  );
}

function LearnA({ level }: { level: 'simple' | 'engineering' }) {
  return (
    <section>
      <h3><IconRoute /> Finding paths: A*</h3>
      {level === 'simple' ? (
        <p>
          Robots can only drive down aisles, never through shelves. A* is the map app of the
          warehouse: it explores outward from the robot and always expands the most promising
          direction first, so it finds the <b>shortest aisle route</b> quickly - and if a shelf
          blocks the way, it walks around.
        </p>
      ) : (
        <p>
          A* on the 4-connected grid with a Manhattan heuristic (admissible and consistent for
          unit-cost orthogonal moves). Distances are computed through aisles - straight-line
          guesses are never used. Unreachable goals return an explicit failure, and BFS distance
          fields (uniform-cost) power the allocator's pairwise estimates; fields are cached per
          map revision and invalidated on edits.
        </p>
      )}
    </section>
  );
}

function LearnB({ level }: { level: 'simple' | 'engineering' }) {
  return (
    <section>
      <h3><IconBox /> Who carries what: capacity-aware allocation</h3>
      {level === 'simple' ? (
        <p>
          A <b>Scout</b> carries one package per trip; a <b>Hauler</b> carries up to ten. Giving
          every robot the same number of packages would be silly - the Hauler should take big
          batches, the Scout should take nearby singles. RoboArena tests "what happens to the
          total finish time if I give <i>this</i> package to <i>that</i> robot" for every option
          and keeps the best one. That's why one robot sometimes stays idle: giving it work would
          make <i>everyone</i> finish later.
        </p>
      ) : (
        <p>
          Greedy cheapest-insertion with makespan bidding (V1 heuristic - not a proven optimum).
          Tasks are processed in stable id order; each is inserted into every feasible
          (robot, trip, position) - including opening a new trip - and scored by the resulting
          estimated fleet makespan using BFS distance fields plus pickup/unload dwell terms.
          Deterministic tie-breaking; bounded 2-opt improves intra-trip order. Capacity is
          enforced per trip at all times; dock-to-dock trips are unlimited.
        </p>
      )}
    </section>
  );
}

function LearnC({ level }: { level: 'simple' | 'engineering' }) {
  return (
    <section>
      <h3><IconShield /> Not bumping into each other: space-time reservations</h3>
      {level === 'simple' ? (
        <p>
          Before anyone moves, every robot books the floor tiles it will occupy, second by second
          - like booking meeting rooms. If two robots would need the same aisle cell at the same
          moment, one of them <b>waits</b> (you'll see the amber ring). Head-on meetings are
          impossible by construction; robots never pass through each other or through shelves.
        </p>
      ) : (
        <p>
          Prioritized space-time A* with a reservation table over (cell, tick) vertices and
          (directed edge, tick) - the reverse-edge check blocks head-on swaps. Waits are first-class
          actions; dwells (pickup/unload) are range-reserved; idle robots and finished robots are
          reserved for the remaining horizon. Priority orders retry in a bounded deterministic
          sequence; unresolved robots are reported as <i>planning failed</i> rather than silently
          overlapping. Prioritized planning is incomplete - a solvable instance may still fail,
          and that is reported honestly.
        </p>
      )}
    </section>
  );
}

function LearnD({ level }: { level: 'simple' | 'engineering' }) {
  return (
    <section>
      <h3><IconReset /> Editing while the world moves</h3>
      {level === 'simple' ? (
        <p>
          Pause, move a package or wall off an aisle, and RoboArena checks the edit, keeps every
          delivered and carried package consistent, and re-plans the rest from the robots'
          current spots. Nothing teleports; if an edit would strand a robot or a package, it is
          rejected with an explanation.
        </p>
      ) : (
        <p>
          Edits are accepted only while paused (design/intervention mode). Committing bumps the
          map revision, invalidates cached distance fields and stale routes, preserves delivered
          and carried state, and re-runs allocation + prioritized space-time planning from the
          robots' current cells at the current tick. Invalid edits roll back with the validation
          reason. Reset is a distinct replay operation that restores the full initial scenario.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Toasts
function ToastHost() {
  return (
    <div className="toast-host">
      {store.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'success' ? <IconCheck /> : t.kind === 'error' || t.kind === 'warn' ? <IconAlert /> : <IconRobot />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
