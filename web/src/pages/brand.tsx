// Brand pieces shared by the landing and login pages.

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 32 36" aria-hidden="true" className="logo-mark">
      <path d="M2 35V16a14 14 0 0 1 28 0v19Z" fill="var(--accent)" />
      <path d="M2 35V16a14 14 0 0 1 28 0v19Z" fill="none" stroke="oklch(1 0 0 / 0.25)" strokeWidth="1" />
      <path d="M11 28V14h6.5a4 4 0 0 1 0 8H11m6.5 0 4.5 6" stroke="var(--accent-fg)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span>Relay</span>
    </span>
  );
}

// A distant skyline of spires and towers, after the castle in the references.
const towers: [number, number, number, number][] = [
  // x, width, wall height, spire height
  [0, 46, 70, 0], [40, 26, 120, 60], [64, 40, 90, 0], [100, 18, 150, 80], [116, 52, 80, 30], [166, 22, 130, 70],
  [186, 60, 100, 0], [244, 30, 190, 110], [272, 44, 120, 50], [314, 20, 160, 90], [332, 70, 95, 0], [400, 28, 140, 70],
  [426, 40, 110, 0], [464, 24, 220, 130], [486, 56, 130, 40], [540, 22, 175, 95], [560, 64, 100, 0], [622, 30, 150, 80],
  [650, 46, 90, 0], [694, 20, 200, 120], [712, 50, 115, 45], [760, 26, 140, 70], [784, 60, 85, 0], [842, 22, 165, 85],
  [862, 44, 105, 0], [904, 30, 135, 75], [932, 70, 80, 0],
];

export function Spires() {
  const d = towers.map(([x, w, h, s]) => {
    const base = 400;
    const top = base - h;
    const body = `M${x},${base}V${top}H${x + w}V${base}Z`;
    const spire = s ? `M${x - 2},${top}L${x + w / 2},${top - s}L${x + w + 2},${top}Z` : '';
    const window = h > 110 ? `M${x + w / 2 - 3},${top + 30}v14a3 3 0 0 0 6 0v-14a3 3 0 0 0-6 0Z` : '';
    return body + spire + window;
  }).join('');
  return (
    <svg className="spires" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="spire-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={d} fill="url(#spire-fade)" fillRule="evenodd" />
    </svg>
  );
}
