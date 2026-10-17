import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Flourish, Icon, MODE_ICON, type IconName } from './Icon';
import type { AppointmentStatus, JobStatus, ShipmentStatus, TransportMode } from '../lib/types';
import { TRANSPORT_LABEL, initials } from '../lib/format';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'gold' | 'default';
  size?: 'sm' | 'lg';
  icon?: IconName;
  iconOnly?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size, icon, iconOnly, loading, loadingLabel, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', variant !== 'default' && variant, size, iconOnly && 'icon', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {loading && loadingLabel && !iconOnly ? loadingLabel : children}
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'gold' | '';

export function Badge({ tone = '', icon, children, className = '' }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`badge ${tone} ${className}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

const JOB_STATUS: Record<JobStatus, [Tone, IconName, string]> = {
  queued: ['info', 'clock', 'Queued'],
  running: ['accent', 'play', 'Running'],
  succeeded: ['good', 'check', 'Succeeded'],
  failed: ['bad', 'alert', 'Failed'],
};
export const JobStatusBadge = ({ status }: { status: JobStatus }) => {
  const [tone, icon, label] = JOB_STATUS[status] ?? JOB_STATUS.queued;
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
};

export const SHIPMENT_STATUS: Record<ShipmentStatus, [Tone, IconName, string]> = {
  booked: ['info', 'clock', 'Booked'],
  in_transit: ['accent', 'route', 'In transit'],
  delayed: ['warn', 'triangle', 'Delayed'],
  delivered: ['good', 'checkCircle', 'Delivered'],
  cancelled: ['', 'x', 'Cancelled'],
};
export const ShipmentStatusBadge = ({ status }: { status: ShipmentStatus }) => {
  const [tone, icon, label] = SHIPMENT_STATUS[status];
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
};

export const APPT_STATUS: Record<AppointmentStatus, [Tone, IconName, string]> = {
  requested: ['warn', 'clock', 'Requested'],
  confirmed: ['info', 'check', 'Confirmed'],
  checked_in: ['accent', 'truck', 'Checked in'],
  completed: ['good', 'checkCircle', 'Completed'],
};
export const ApptBadge = ({ status }: { status: AppointmentStatus }) => {
  const [tone, icon, label] = APPT_STATUS[status];
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
};

export function ModeChip({ mode }: { mode: TransportMode }) {
  return (
    <span className="mode-chip">
      <span className={`mode-dot ${mode}`} aria-hidden="true" />
      <Icon name={MODE_ICON[mode]} size={14} />
      {TRANSPORT_LABEL[mode]}
    </span>
  );
}

export function Empty({ icon = 'inbox', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon"><Icon name={icon} size={20} /></div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Empty icon="alert" title="Couldn’t load this" action={onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}>
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </Empty>
  );
}

export const Skeleton = ({ h = 16, w, r }: { h?: number; w?: number | string; r?: number }) => (
  <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />
);

export function PageHead({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="titles">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Ornament({ className = '' }: { className?: string }) {
  return <div className={`ornament ${className}`} role="presentation"><Flourish /></div>;
}

export function Avatar({ name, accent }: { name: string; accent?: boolean }) {
  return <span className={`avatar ${accent ? 'accent' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

export function Kpi({ label, value, unit, delta, deltaTone, icon }: {
  label: ReactNode; value: ReactNode; unit?: string; delta?: ReactNode; deltaTone?: 'good' | 'bad'; icon?: IconName;
}) {
  return (
    <div className="card kpi">
      <span className="k">{icon && <Icon name={icon} size={14} />}{label}</span>
      <span className="v">{value}{unit && <small>{unit}</small>}</span>
      <span className={`d ${deltaTone || ''}`}>{delta}</span>
    </div>
  );
}

export function Progress({ value, max = 1, label, tone }: { value: number; max?: number; label: string; tone?: 'gold' }) {
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={`progress ${tone || ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ transform: `scaleX(${f})` }} />
    </div>
  );
}
