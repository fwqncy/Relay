// Appearance: light/dark mode plus a colour scheme. Every scheme is four
// numbers — neutral hue and chroma, accent hue and chroma — and the token
// formulas in tokens.css turn them into a full palette for either mode,
// with lightness fixed per token so contrast holds whatever colour is picked.

export type Mode = 'system' | 'light' | 'dark';
export type SchemeId = 'moss' | 'burgundy' | 'navy' | 'company' | 'custom';

export interface Appearance {
  mode: Mode;
  scheme: SchemeId;
  customColor: string;
}

export interface Palette {
  h: number; // neutral hue
  nc: number; // neutral chroma
  ah: number; // accent hue
  ac: number; // accent chroma
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', scheme: 'moss', customColor: '#6f8f5e' };

const PRESETS: Record<'moss' | 'burgundy' | 'navy', Palette> = {
  moss: { h: 145, nc: 0.014, ah: 142, ac: 0.075 },
  burgundy: { h: 12, nc: 0.017, ah: 14, ac: 0.13 },
  navy: { h: 258, nc: 0.02, ah: 262, ac: 0.11 },
};

export const SCHEMES: { id: SchemeId; name: string; description: string }[] = [
  { id: 'moss', name: 'Moss', description: 'Grey stone and dark green, like a ruin in the fog.' },
  { id: 'burgundy', name: 'Burgundy', description: 'Wine-dark neutrals with a deep red accent.' },
  { id: 'navy', name: 'Navy', description: 'Slate blue neutrals with a naval blue accent.' },
  { id: 'company', name: 'Company', description: 'Your company’s brand colour.' },
  { id: 'custom', name: 'Custom', description: 'Any colour you pick on the wheel.' },
];

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function paletteFromHex(hex: string): Palette {
  const { c, h } = hexToOklch(hex);
  return {
    h: Math.round(h),
    nc: +clamp(c * 0.16, 0.004, 0.022).toFixed(4),
    ah: Math.round(h),
    ac: +clamp(c, 0.02, 0.17).toFixed(4),
  };
}

export function paletteFor(a: Appearance, companyColor?: string): Palette {
  if (a.scheme === 'custom') return paletteFromHex(a.customColor);
  if (a.scheme === 'company') return paletteFromHex(companyColor || DEFAULT_APPEARANCE.customColor);
  return PRESETS[a.scheme] ?? PRESETS.moss;
}

export const paletteVars = (p: Palette): Record<string, string> => ({
  '--h': String(p.h),
  '--nc': String(p.nc),
  '--ah': String(p.ah),
  '--ac': String(p.ac),
});

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const resolveMode = (m: Mode): 'light' | 'dark' => (m === 'dark' || (m === 'system' && darkQuery?.matches) ? 'dark' : 'light');

const STORAGE_KEY = 'relay-appearance';

export function readStoredAppearance(): Appearance {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_APPEARANCE, ...pick(s) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function pick(s: Partial<Appearance>): Partial<Appearance> {
  const out: Partial<Appearance> = {};
  if (s.mode === 'system' || s.mode === 'light' || s.mode === 'dark') out.mode = s.mode;
  if (SCHEMES.some((x) => x.id === s.scheme)) out.scheme = s.scheme;
  if (typeof s.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.customColor)) out.customColor = s.customColor;
  return out;
}

// Convert any CSS colour to #rrggbb by letting the browser paint it.
let probe: CanvasRenderingContext2D | null = null;
export function cssToHex(color: string): string {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return '#000000';
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function applyAppearance(a: Appearance, companyColor?: string) {
  const root = document.documentElement;
  const resolved = resolveMode(a.mode);
  root.dataset.mode = resolved;
  const vars = paletteVars(paletteFor(a, companyColor));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...a, vars }));
  } catch {
    /* private mode */
  }
  // Browser UI (mobile address bar) follows the page background.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', cssToHex(bg));
  });
}

export function onSystemModeChange(fn: () => void) {
  darkQuery?.addEventListener('change', fn);
  return () => darkQuery?.removeEventListener('change', fn);
}

// ---- HSV helpers for the colour wheel ----

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
