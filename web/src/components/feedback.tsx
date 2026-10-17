import * as RDialog from '@radix-ui/react-dialog';
import {
  cloneElement, createContext, isValidElement, useCallback, useContext, useId, useMemo, useRef, useState,
  type FormEvent, type ReactElement, type ReactNode,
} from 'react';
import { ApiError } from '../lib/api';
import { Icon, type IconName } from './Icon';
import { Button } from './ui';

/* ───────────── Toasts ───────────── */

type ToastTone = 'good' | 'bad' | 'info' | 'gold';
interface ToastItem { id: number; title: string; body?: string; tone: ToastTone }
const ToastCtx = createContext<(title: string, body?: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);
  const schedule = useCallback((id: number, ms: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => remove(id), ms));
  }, [remove]);
  const toast = useCallback((title: string, body?: string, tone: ToastTone = 'good') => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, title, body, tone }]);
    schedule(id, tone === 'bad' ? 8000 : 5000);
  }, [schedule]);
  const icons: Record<ToastTone, IconName> = { good: 'checkCircle', bad: 'alert', info: 'zap', gold: 'trophy' };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onPointerEnter={() => clearTimeout(timers.current.get(t.id))} onPointerLeave={() => schedule(t.id, 2500)}>
            <span className="t-icon"><Icon name={icons[t.tone]} size={16} /></span>
            <div className="t-body"><strong>{t.title}</strong>{t.body && <span>{t.body}</span>}</div>
            <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="Dismiss notification" onClick={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// Screen-reader announcements that aren't worth a toast.
export function announce(msg: string) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

/* ───────────── Dialogs ───────────── */

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({ open, onOpenChange, title, description, wide, children, footer, className = '' }: ModalProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className={`dialog ${wide ? 'wide' : ''} ${className}`} aria-describedby={description ? undefined : undefined}>
          <div className="dialog-inner">
            <div className="dialog-head">
              <RDialog.Title asChild><h2>{title}</h2></RDialog.Title>
              {description ? <RDialog.Description asChild><p>{description}</p></RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            {children && <div className="dialog-body">{children}</div>}
            <div className="dialog-foot">{footer ?? <RDialog.Close asChild><Button>Close</Button></RDialog.Close>}</div>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

const FormCtx = createContext<{ errors: Record<string, string> }>({ errors: {} });

interface FormDialogProps extends Omit<ModalProps, 'footer' | 'children'> {
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitIcon?: IconName;
  danger?: boolean;
  footLeft?: ReactNode;
  onSubmit: (form: HTMLFormElement) => Promise<void | false>;
}

/** A dialog wrapping a form. Server field errors appear under the matching
 *  field and take focus; other errors show at the top of the form. */
export function FormDialog({ open, onOpenChange, title, description, wide, children, submitLabel, pendingLabel, submitIcon, danger, footLeft, onSubmit, className = '' }: FormDialogProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    setErrors({});
    setFormError('');
    setPending(true);
    try {
      const keep = await onSubmit(form);
      if (keep !== false) onOpenChange(false);
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      const input = field ? form.querySelector<HTMLElement>(`[name="${field}"]`) : null;
      if (field && input) {
        setErrors({ [field]: msg });
        requestAnimationFrame(() => input.focus());
      } else {
        setFormError(msg);
      }
    } finally {
      setPending(false);
    }
  };

  const ctx = useMemo(() => ({ errors }), [errors]);
  return (
    <RDialog.Root open={open} onOpenChange={(o) => { if (!o) { setErrors({}); setFormError(''); } onOpenChange(o); }}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className={`dialog ${wide ? 'wide' : ''} ${className}`}>
          <form ref={formRef} onSubmit={submit} noValidate>
            <div className="dialog-head">
              <RDialog.Title asChild><h2>{title}</h2></RDialog.Title>
              {description ? <RDialog.Description asChild><p>{description}</p></RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <div className="dialog-body">
              {formError && <div className="form-error" role="alert"><Icon name="alert" size={15} /><span>{formError}</span></div>}
              <FormCtx.Provider value={ctx}>{children}</FormCtx.Provider>
            </div>
            <div className="dialog-foot">
              {footLeft && <span className="left">{footLeft}</span>}
              <RDialog.Close asChild><Button>Cancel</Button></RDialog.Close>
              <Button type="submit" variant={danger ? 'danger' : 'primary'} icon={submitIcon} loading={pending} loadingLabel={pendingLabel}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Label + control + hint + error, wired with ids and aria attributes. */
export function Field({ name, label, hint, children, className = '' }: { name: string; label: ReactNode; hint?: ReactNode; children: ReactElement<Record<string, unknown>>; className?: string }) {
  const { errors } = useContext(FormCtx);
  const id = useId();
  const error = errors[name];
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, name, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })
    : children;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="error" id={`${id}-error`}><Icon name="alert" size={14} /><span>{error}</span></p>}
    </div>
  );
}

export function useFieldError(name: string) {
  return useContext(FormCtx).errors[name];
}

/* ───────────── Confirm ───────────── */

interface ConfirmOpts { title: string; description: ReactNode; confirmLabel: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>(undefined);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => { resolver.current = resolve; setOpts(o); }), []);
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = undefined; setOpts(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onOpenChange={(o) => { if (!o) close(false); }}
        title={opts?.title ?? ''}
        description={opts?.description}
        footer={<>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={opts?.danger === false ? 'primary' : 'danger'} onClick={() => close(true)}>{opts?.confirmLabel}</Button>
        </>}
      />
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
