import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAppearance, useMe } from '../lib/session';
import { hexToHsv, hsvToHex, paletteFor, paletteFromHex, SCHEMES, type Mode, type Palette, type SchemeId } from '../lib/theme';
import { Icon } from './Icon';
import { Button } from './ui';

const MODE_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

/** Light / dark / system as a native select — the dropdown the brief asked for. */
export function ModeSelect({ className = '' }: { className?: string }) {
  const { appearance, setAppearance } = useAppearance();
  return (
    <label className={`theme-select ${className}`}>
      <span className="sr-only">Theme mode</span>
      <Icon name={MODE_ICON[appearance.mode]} size={15} />
      <select className="select sm" value={appearance.mode} onChange={(e) => setAppearance({ mode: e.target.value as Mode })} aria-label="Theme mode">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

const accentFor = (p: Palette, dark: boolean) => `oklch(${dark ? 0.76 : 0.47} ${p.ac} ${p.ah})`;

export function SchemeSwatches({ compact = false }: { compact?: boolean }) {
  const { appearance, setAppearance } = useAppearance();
  const company = useMe().data?.company;
  const dark = document.documentElement.dataset.mode === 'dark';
  const schemes = company ? SCHEMES : SCHEMES.filter((s) => s.id !== 'company');
  return (
    <div className="swatches" role="group" aria-label="Colour scheme" style={{ gridTemplateColumns: `repeat(${schemes.length}, 1fr)` }}>
      {schemes.map((s) => {
        const p = paletteFor({ ...appearance, scheme: s.id }, company?.accentLight);
        const pressed = appearance.scheme === s.id;
        const showWheel = s.id === 'custom' && !pressed;
        return (
          <button key={s.id} type="button" className="swatch" aria-pressed={pressed} title={compact ? s.description : undefined}
            onClick={() => setAppearance({ scheme: s.id as SchemeId })}>
            <i className={showWheel ? 'wheel-chip' : ''} style={showWheel ? undefined : { background: accentFor(p, dark) }} />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** Palette button that opens the scheme picker with the colour wheel. */
export function SchemePicker() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" iconOnly icon="palette" aria-label="Colour scheme" title="Colour scheme" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover scheme-pop" side="top" align="start" sideOffset={8} collisionPadding={12}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: 14 }}>Colour scheme</h2>
            <Link to="/settings#appearance" className="subtle" style={{ fontSize: 12 }}>All settings</Link>
          </div>
          <SchemeSwatches compact />
          {appearance.scheme === 'custom' && (
            <ColorWheel value={appearance.customColor} onChange={(hex) => setAppearance({ customColor: hex })} size={150} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ───────────── Colour wheel ───────────── */

export function ColorWheel({ value, onChange, size = 168 }: { value: string; onChange: (hex: string) => void; size?: number }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value);
  const wheel = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const id = useId();

  // Follow outside changes without fighting the user's drag.
  useEffect(() => {
    if (dragging.current) return;
    const cur = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (cur.toLowerCase() !== value.toLowerCase()) setHsv(hexToHsv(value));
    setHexDraft(value);
  }, [value]);

  const commit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexDraft(hex);
    onChange(hex);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = wheel.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    const radius = r.width / 2;
    let h = (Math.atan2(y, x) * 180) / Math.PI;
    if (h < 0) h += 360;
    commit({ h, s: Math.min(1, Math.hypot(x, y) / radius), v: hsv.v });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15 : 5;
    const map: Record<string, () => { h: number; s: number; v: number }> = {
      ArrowRight: () => ({ ...hsv, h: (hsv.h + step) % 360 }),
      ArrowLeft: () => ({ ...hsv, h: (hsv.h - step + 360) % 360 }),
      ArrowUp: () => ({ ...hsv, s: Math.min(1, hsv.s + step / 100) }),
      ArrowDown: () => ({ ...hsv, s: Math.max(0, hsv.s - step / 100) }),
    };
    if (map[e.key]) {
      e.preventDefault();
      commit(map[e.key]());
    }
  };

  const angle = (hsv.h * Math.PI) / 180;
  const thumb = { left: `${50 + Math.cos(angle) * hsv.s * 50}%`, top: `${50 + Math.sin(angle) * hsv.s * 50}%` };
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const p = paletteFromHex(hex);

  return (
    <div className="wheel-wrap">
      <div
        ref={wheel}
        className="wheel"
        style={{ width: size, height: size, ['--dim' as string]: String(1 - hsv.v) }}
        tabIndex={0}
        role="slider"
        aria-label="Colour wheel: arrow keys change hue (left, right) and saturation (up, down)"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`Hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)} percent, ${hex}`}
        onKeyDown={onKey}
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
        onPointerMove={(e) => { if (dragging.current) fromPointer(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <span className="wheel-thumb" style={{ ...thumb, background: hex }} />
      </div>
      <div className="wheel-side">
        <div className="field">
          <label htmlFor={`${id}-v`}>Brightness</label>
          <input id={`${id}-v`} className="range" type="range" min={20} max={100} value={Math.round(hsv.v * 100)}
            onChange={(e) => commit({ ...hsv, v: Number(e.target.value) / 100 })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-hex`}>Hex</label>
          <input id={`${id}-hex`} className="input sm mono" value={hexDraft} spellCheck={false} autoComplete="off" maxLength={7}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHexDraft(v);
              if (/^#[0-9a-f]{6}$/i.test(v)) { setHsv(hexToHsv(v)); onChange(v.toLowerCase()); }
            }} />
        </div>
        <div className="preview-pair" aria-label="Preview">
          <div className="preview" style={{ background: `oklch(0.985 0.005 ${p.h})`, color: '#333' }}>
            Light<b style={{ background: accentFor(p, false) }} />
          </div>
          <div className="preview" style={{ background: `oklch(0.2 ${p.nc} ${p.h})`, color: '#ddd' }}>
            Dark<b style={{ background: accentFor(p, true) }} />
          </div>
        </div>
        <p className="subtle" style={{ fontSize: 12 }}>Lightness is tuned per mode so text stays readable.</p>
      </div>
    </div>
  );
}
