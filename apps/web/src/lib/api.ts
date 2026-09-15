const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
};

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('nomchael_token');
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem('nomchael_token', token);
  localStorage.setItem('nomchael_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('nomchael_token');
  localStorage.removeItem('nomchael_user');
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('nomchael_user');
  return raw ? JSON.parse(raw) : null;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    clearAuth();
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = Array.isArray(err.message)
      ? err.message.join(', ')
      : err.message || 'Request failed';
    throw new Error(msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Authenticated PDF download (Bearer token). Triggers a real file save. */
export async function downloadPdf(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    clearAuth();
    window.location.href = '/login';
    throw new Error('Please sign in again to download the PDF');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = Array.isArray(err.message)
      ? err.message.join(', ')
      : err.message || 'PDF download failed';
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.\-]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function money(cents: number, currency = 'USD') {
  return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;
}
