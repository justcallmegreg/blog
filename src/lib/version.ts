// The engine's build provenance, exposed at /version.
// - VERSION: from VERSION.txt, embedded at build time (Vite `?raw`).
// - COMMIT / BUILT_AT: injected by Vite `define` (see astro.config.mjs).
// The `typeof` guards keep this importable outside a Vite build (e.g. unit
// tests), where the defines are absent.
import raw from '../../VERSION.txt?raw';

export const VERSION = raw.trim();
export const COMMIT = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown';
export const BUILT_AT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown';
