export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

// Fired on 401 so the app can drop the session and show the login page.
export const UNAUTHORIZED_EVENT = 'relay:unauthorized';

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'relay',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach the Relay server. Check that it’s running, then try again.', 0);
  }
  if (res.status === 204) return undefined as T;
  let data: { error?: string; field?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status, data?.field);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);

// Keep a spinner up for at least a beat so fast responses don't flicker.
export function minDelay<T>(p: Promise<T>, ms = 350): Promise<T> {
  return Promise.all([p, new Promise((r) => setTimeout(r, ms))]).then(([v]) => v);
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
