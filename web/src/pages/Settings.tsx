import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ShortcutList } from '../components/Shell';
import { ColorWheel, SchemeSwatches } from '../components/ThemeControls';
import { Icon } from '../components/Icon';
import { Avatar, Badge, PageHead } from '../components/ui';
import { useAppearance, useIsManager, useSession, useTitle } from '../lib/session';
import { SCHEMES, type Mode } from '../lib/theme';

export default function Settings() {
  useTitle('Settings');
  const { user, company } = useSession();
  const manager = useIsManager();
  const { appearance, setAppearance } = useAppearance();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);
  const scheme = SCHEMES.find((s) => s.id === appearance.scheme);

  return (
    <div className="page settings" data-animate>
      <PageHead eyebrow={company.name} title="Settings">Appearance is saved to your account and follows you to any device.</PageHead>

      <section className="card" id="appearance" aria-labelledby="appearance-title">
        <div className="card-head"><div><h2 id="appearance-title">Appearance</h2><p className="sub">Choose light or dark, then a colour scheme.</p></div></div>
        <div className="card-body settings-grid">
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 8 }}>Mode</legend>
            <div className="segmented" role="radiogroup" aria-label="Theme mode">
              {(['system', 'light', 'dark'] as Mode[]).map((m) => (
                <label key={m}>
                  <input type="radio" name="mode" value={m} checked={appearance.mode === m} onChange={() => setAppearance({ mode: m })} />
                  <Icon name={m === 'system' ? 'monitor' : m === 'light' ? 'sun' : 'moon'} size={14} />{m[0].toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
            <p className="hint">System follows your device and switches automatically.</p>
          </fieldset>
          <div className="field">
            <span className="label">Colour scheme</span>
            <SchemeSwatches />
            <p className="hint">{scheme?.description}</p>
          </div>
          <div className="field">
            <span className="label">Custom colour</span>
            {appearance.scheme === 'custom'
              ? <ColorWheel value={appearance.customColor} onChange={(hex) => setAppearance({ customColor: hex })} />
              : <p className="hint"><button type="button" className="linkish" onClick={() => setAppearance({ scheme: 'custom' })}>Use a custom colour</button> to pick any hue on the colour wheel.</p>}
          </div>
        </div>
      </section>

      <div className="grid-2 even">
        <section className="card" aria-labelledby="profile-title">
          <div className="card-head"><h2 id="profile-title">Profile</h2></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
              <Avatar name={user.name} accent />
              <div><strong>{user.name}</strong><div className="muted">{user.title}</div></div>
              <Badge tone="accent" className="push">{manager ? 'Manager' : 'Employee'}</Badge>
            </div>
            <dl className="kv">
              <dt>Email</dt><dd>{user.email}</dd>
              <dt>Company</dt><dd style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="mode-dot" style={{ background: company.accentLight }} aria-hidden="true" />{company.name}</dd>
              <dt>Hub</dt><dd>{company.hub}</dd>
            </dl>
          </div>
        </section>
        <section className="card" aria-labelledby="keys-title">
          <div className="card-head"><h2 id="keys-title">Keyboard shortcuts</h2></div>
          <div className="card-body"><ShortcutList /></div>
        </section>
      </div>

      <section className="card" aria-labelledby="export-title">
        <div className="card-head"><div><h2 id="export-title">Export data</h2><p className="sub">CSV files open in any spreadsheet.</p></div></div>
        <div className="card-body actions">
          <a className="btn" href="/api/export/shipments.csv" download><Icon name="package" size={15} />Shipments</a>
          <a className="btn" href="/api/export/inventory.csv" download><Icon name="boxes" size={15} />Inventory</a>
          <a className="btn" href="/api/export/jobs.csv" download><Icon name="list" size={15} />{manager ? 'Jobs' : 'My jobs'}</a>
          {manager && <a className="btn" href="/api/export/activity.csv" download><Icon name="scroll" size={15} />Activity log</a>}
        </div>
      </section>
    </div>
  );
}
