/**
 * Draw the Fallout vault gear-door into an SVG element. Shared by the blog intro
 * (VaultDoorIntro) and the deck presenter so the two draw the identical door.
 * `vault` is the door number rendered on the hub. Client-only (uses `document`).
 */
export function buildDoor(svg: SVGSVGElement, vault: string): void {
  const NS = 'http://www.w3.org/2000/svg';
  const C = 300;
  const el = (name: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    parent.appendChild(n);
    return n;
  };

  const defs = el('defs', {});
  defs.innerHTML = `
    <radialGradient id="vi-steel" cx="42%" cy="36%" r="75%">
      <stop offset="0%"  stop-color="#8d968c"/>
      <stop offset="42%" stop-color="#5c655c"/>
      <stop offset="78%" stop-color="#39413a"/>
      <stop offset="100%" stop-color="#242b25"/>
    </radialGradient>
    <radialGradient id="vi-hub" cx="45%" cy="40%" r="70%">
      <stop offset="0%"  stop-color="#6e776d"/>
      <stop offset="70%" stop-color="#414942"/>
      <stop offset="100%" stop-color="#272e28"/>
    </radialGradient>
    <linearGradient id="vi-tooth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#707a70"/>
      <stop offset="100%" stop-color="#2c332d"/>
    </linearGradient>
    <filter id="vi-rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
      <feComposite operator="over" in2="SourceGraphic"/></filter>
  `;

  el('circle', { cx: C, cy: C, r: 284, fill: '#232923', stroke: '#0e120e', 'stroke-width': 2 });

  const teeth = el('g', {});
  for (let i = 0; i < 24; i++) {
    el('rect', {
      x: C - 13, y: 4, width: 26, height: 34, rx: 3,
      fill: 'url(#vi-tooth)', stroke: '#141814', 'stroke-width': 1.5,
      transform: `rotate(${i * 15} ${C} ${C})`,
    }, teeth);
  }

  el('circle', { cx: C, cy: C, r: 268, fill: 'url(#vi-steel)', stroke: '#101410', 'stroke-width': 3 });
  [252, 214, 196].forEach((r, i) =>
    el('circle', { cx: C, cy: C, r, fill: 'none', stroke: i % 2 ? '#1c221c' : '#6b746a', 'stroke-width': i % 2 ? 5 : 2, opacity: 0.8 }));

  for (let i = 0; i < 6; i++) {
    el('line', {
      x1: C, y1: C - 196, x2: C, y2: C - 118,
      stroke: '#20261f', 'stroke-width': 7, 'stroke-linecap': 'round',
      transform: `rotate(${i * 60 + 30} ${C} ${C})`,
    });
  }
  el('path', { d: `M ${C} ${C} L ${C - 190} ${C - 60} A 200 200 0 0 1 ${C - 40} ${C - 195} Z`, fill: 'rgba(255,255,255,0.05)' });
  el('path', { d: `M ${C} ${C} L ${C + 120} ${C + 160} A 200 200 0 0 1 ${C - 90} ${C + 178} Z`, fill: 'rgba(0,0,0,0.18)' });

  const rivets = el('g', {});
  const ring = (r: number, n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      el('circle', {
        cx: C + Math.cos(a) * r, cy: C + Math.sin(a) * r, r: size,
        fill: '#525b52', stroke: '#171c17', 'stroke-width': 1.5,
      }, rivets);
    }
  };
  ring(233, 32, 5.5);
  ring(174, 20, 4.5);

  el('circle', { cx: C, cy: C, r: 104, fill: 'url(#vi-hub)', stroke: '#161b16', 'stroke-width': 4 });
  el('circle', { cx: C, cy: C, r: 86, fill: 'none', stroke: '#5f685e', 'stroke-width': 2, opacity: 0.7 });
  for (let i = 0; i < 3; i++) {
    el('rect', {
      x: C - 80, y: C - 9, width: 160, height: 18, rx: 8,
      fill: '#333a33', stroke: '#141914', 'stroke-width': 2,
      transform: `rotate(${i * 60} ${C} ${C})`,
    });
  }
  el('circle', { cx: C, cy: C, r: 26, fill: '#2a302a', stroke: '#101510', 'stroke-width': 3 });
  el('circle', { cx: C, cy: C, r: 9, fill: '#4c554c' });

  const numSize = vault.length > 2 ? 200 : 280;
  const num = el('text', {
    x: C, y: C + (vault.length > 2 ? 70 : 96), 'text-anchor': 'middle',
    'font-family': 'var(--font)', 'font-size': numSize,
    fill: '#d8b445', opacity: 0.88, 'letter-spacing': '8',
    stroke: '#3f3210', 'stroke-width': 3,
  });
  num.textContent = vault;
  el('text', {
    x: C, y: C + 236, 'text-anchor': 'middle',
    'font-family': 'var(--font)', 'font-size': 30,
    fill: '#c9a83f', opacity: 0.6, 'letter-spacing': '6',
  }).textContent = 'VAULT-TEC';

  el('circle', { cx: C, cy: C, r: 268, fill: '#000', opacity: 0.16, filter: 'url(#vi-rough)' });
}
