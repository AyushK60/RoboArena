// Studio theme (presentation only): light = paper plan, dark = graphite. Persisted per browser.
// Sets <html data-theme>, the canvas palette (render/palette) and notifies subscribers
// (the PixiJS renderer rebuilds its baked colours; React re-renders for swatches and robot dots).
import { useSyncExternalStore } from 'react';
import { setCanvasTheme, type CanvasThemeName } from '../render/palette';

export type Theme = CanvasThemeName;
const KEY = 'roboarena-theme';
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage unavailable: fall through to the default
  }
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

let current: Theme = initial();

function apply(t: Theme): void {
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F1ECE1' : '#0F1114');
  setCanvasTheme(t);
}
apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(t: Theme): void {
  if (t === current) return;
  current = t;
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme(): [Theme, () => void] {
  const t = useSyncExternalStore(subscribeTheme, getTheme);
  return [t, () => setTheme(t === 'dark' ? 'light' : 'dark')];
}
