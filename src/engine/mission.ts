// Mission fingerprint: a stable hash of everything a plan depends on. When it changes,
// the committed plan is stale and must be recomputed before playback (see store.isPlanStale).
import type { Scenario } from './types';

export function missionFingerprint(scenario: Scenario, taskIds: string[], robotIds: string[]): string {
  const tasks = [...taskIds].sort().join(',');
  const robots = robotIds
    .sort()
    .map((id) => {
      const r = scenario.robots.find((x) => x.id === id);
      return r ? `${r.id}:${r.type}:${r.capacity}:${r.homeCell}` : `${id}:missing`;
    })
    .join(',');
  const selectedCells = [...taskIds]
    .sort()
    .map((id) => {
      const p = scenario.packages.find((x) => x.id === id);
      return p ? `${p.id}@${p.cell}:${p.pickupCell}` : `${id}@missing`;
    })
    .join(',');
  const docks: number[] = [];
  for (let i = 0; i < scenario.map.cells.length; i++) {
    if (scenario.map.cells[i] === 3) docks.push(i);
  }
  return `v1|map:${scenario.map.id}|rev:${scenario.map.revision}|tasks:${tasks}|cells:${selectedCells}|robots:${robots}|docks:${docks.join(',')}`;
}
