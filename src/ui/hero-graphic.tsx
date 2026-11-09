// Landing hero: an original, animated SVG plan sheet of a warehouse operation - racks, pick
// nodes, two planned routes and a Scout and a Hauler travelling them. Pure presentation (no
// simulation data). All colour comes from CSS tokens (.hg-* in global.css) and the frame is
// a .t-dark scope; animations are slow and disabled under prefers-reduced-motion.
const RACK_COLS = [170, 440, 710];
const RACK_ROWS = [52, 144, 236, 328];

export function HeroGraphic() {
  return (
    <div className="hg" role="img" aria-label="Plan sheet of a warehouse: a Scout and a Hauler robot travel planned routes from racks to the dock">
      <svg viewBox="0 0 1200 420" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="hg-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M30 0H0V30" className="hg-bg-grid" />
          </pattern>
        </defs>

        {/* drafting ground + floor plate */}
        <rect x="0" y="0" width="1200" height="420" fill="url(#hg-grid)" opacity="0.55" />
        <rect x="14" y="14" width="1172" height="392" rx="4" className="hg-plate" />

        {/* receiving strip (left) and dock (right) */}
        <rect x="40" y="130" width="80" height="160" rx="3" className="hg-zone-in" />
        <text x="80" y="214" textAnchor="middle" className="hg-label">IN</text>
        <rect x="1080" y="130" width="80" height="160" rx="3" className="hg-zone-dock" />
        <text x="1120" y="214" textAnchor="middle" className="hg-label">DOCK</text>

        {/* rack blocks with slot detail */}
        {RACK_ROWS.map((y) =>
          RACK_COLS.map((x) => (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="210" height="52" rx="3" className="hg-rack-body" />
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <line key={s} x1={x + s * 30} y1={y + 6} x2={x + s * 30} y2={y + 46} className="hg-rack-line" />
              ))}
              <line x1={x + 6} y1={y + 26} x2={x + 204} y2={y + 26} className="hg-rack-line" />
            </g>
          )),
        )}

        {/* pick nodes - pulse in sequence */}
        {[
          { x: 680, y: 124, b: false },
          { x: 410, y: 216, b: false },
          { x: 680, y: 308, b: false },
          { x: 410, y: 124, b: true },
        ].map((p, i) => (
          <g key={i} className={`hg-pick ${p.b ? 'hg-pick-b' : ''}`} style={{ animationDelay: `${i * 2}s` }}>
            <rect x={p.x - 7} y={p.y - 7} width="14" height="14" rx="2" className="hg-pick-box" />
            <circle cx={p.x} cy={p.y} r="2.4" className="hg-pick-dot" />
          </g>
        ))}

        {/* planned routes */}
        <path className="hg-route hg-route-a" d="M 1080 175 H 1000 V 124 H 680 V 216 H 410 V 308 H 1000 V 245 H 1080" />
        <path className="hg-route hg-route-b" d="M 1080 262 H 1000 V 393 H 145 V 124 H 410" />
        <path d="M 120 210 H 145" className="hg-route hg-route-a" style={{ animation: 'none', strokeDasharray: 'none' }} />

        {/* direction ticks */}
        <path className="hg-tick" d="M846 119 l-9 5 9 5 z" />
        <path className="hg-tick" d="M556 303 l9 5 -9 5 z" />
        <path className="hg-tick-b" d="M700 388 l-9 5 9 5 z" />
        <path className="hg-tick-b" d="M140 270 l5 -9 5 9 z" />

        {/* Scout S1 on route A */}
        <g className="hg-robot hg-robot-a">
          <rect x="-11" y="-8" width="22" height="16" rx="2.5" className="hg-robot-s" />
          <rect x="-6" y="-4.5" width="7" height="9" rx="1" className="hg-robot-sw" />
          <text x="0" y="22" textAnchor="middle" className="hg-robot-id">S1</text>
        </g>
        {/* Hauler H10 on route B */}
        <g className="hg-robot hg-robot-b">
          <rect x="-13" y="-10" width="26" height="20" rx="3" className="hg-robot-h" />
          <rect x="-8" y="-6" width="9" height="12" rx="1" className="hg-robot-hw" />
          <text x="0" y="26" textAnchor="middle" className="hg-robot-id">H10</text>
        </g>

        {/* annotations */}
        <text x="170" y="38" className="hg-caption">STORAGE · SLOTS</text>
        <text x="40" y="318" className="hg-caption">RECEIVING</text>
        <text x="1080" y="318" className="hg-caption">OUTBOUND</text>
      </svg>
    </div>
  );
}
