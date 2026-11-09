// PixiJS reads `navigator` on import; Node < 21 does not define it globally.
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', platform: 'node' },
    configurable: true,
  });
}
