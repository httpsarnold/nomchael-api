'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';

export type LocationNotice = {
  id: string;
  code: string;
  name: string;
  status: string;
  address?: string | null;
  standNumber?: number | null;
  projectCount?: number;
  message?: string;
  client?: { name: string };
  standPackage?: { name: string } | null;
  title: string;
};

type QuoteNotice = {
  id: string;
  version: number;
  totalCents: number;
  title: string;
  message: string;
  project?: { id: string; code: string; name: string; client?: { name: string } };
};

type BellItem =
  | { kind: 'gps'; data: LocationNotice }
  | { kind: 'md'; data: QuoteNotice };

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[]>([]);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const user = getUser();
  const canMd =
    user?.role === 'MANAGING_DIRECTOR' || user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    try {
      const requests: Promise<any>[] = [api<LocationNotice[]>('/projects/needs-location')];
      if (canMd) requests.push(api<QuoteNotice[]>('/quotations/pending-md'));
      const [gps, pending] = await Promise.all(requests);
      const next: BellItem[] = (gps as LocationNotice[]).map((data) => ({ kind: 'gps', data }));
      if (canMd && pending) {
        for (const data of pending as QuoteNotice[]) next.push({ kind: 'md', data });
      }
      setItems(next);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [canMd]);

  useEffect(() => {
    load().catch(() => undefined);
    const onFocus = () => load().catch(() => undefined);
    const onRefresh = () => load().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    window.addEventListener('nomchael:notifications-refresh', onRefresh);
    const timer = window.setInterval(() => load().catch(() => undefined), 120000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('nomchael:notifications-refresh', onRefresh);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function openItem(item: BellItem) {
    setOpen(false);
    if (item.kind === 'gps') {
      router.push(`/projects/${item.data.id}/capture`);
      return;
    }
    router.push('/quotations');
  }

  const gpsCount = items.filter((i) => i.kind === 'gps').length;
  const mdCount = items.filter((i) => i.kind === 'md').length;

  return (
    <div className="notif-wrap" ref={panelRef}>
      <button
        type="button"
        className="icon-btn notif-bell"
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          load().catch(() => undefined);
        }}
      >
        🔔
        {items.length > 0 && (
          <span className="notif-badge">{items.length > 9 ? '9+' : items.length}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <strong>Notifications</strong>
            <button type="button" className="logout-link" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {error && (
            <p className="error" style={{ margin: '0.5rem 0.85rem' }}>
              {error}
            </p>
          )}
          {!error && items.length === 0 && (
            <p className="muted" style={{ margin: '0.85rem' }}>
              Nothing waiting right now.
            </p>
          )}
          <ul className="notif-list">
            {items.map((item) =>
              item.kind === 'gps' ? (
                <li key={`gps-${item.data.id}`}>
                  <button type="button" className="notif-item" onClick={() => openItem(item)}>
                    <span className="notif-item-title">
                      {item.data.standPackage?.name || item.data.name}
                    </span>
                    <span className="notif-item-meta">
                      {item.data.message ||
                        `${item.data.code}${item.data.client?.name ? ` · ${item.data.client.name}` : ''}`}
                    </span>
                    <span className="notif-item-action">
                      {item.data.projectCount && item.data.projectCount > 1
                        ? `Capture site GPS for ${item.data.projectCount} projects →`
                        : 'Capture site GPS →'}
                    </span>
                  </button>
                </li>
              ) : (
                <li key={`md-${item.data.id}`}>
                  <button type="button" className="notif-item" onClick={() => openItem(item)}>
                    <span className="notif-item-title">
                      {item.data.project?.name || item.data.message}
                    </span>
                    <span className="notif-item-meta">
                      {item.data.project?.code || ''} · Quotation v{item.data.version}
                      {item.data.project?.client?.name
                        ? ` · ${item.data.project.client.name}`
                        : ''}
                    </span>
                    <span className="notif-item-action">MD approval needed →</span>
                  </button>
                </li>
              ),
            )}
          </ul>
          {(gpsCount > 0 || mdCount > 0) && (
            <div className="notif-footer-links">
              {gpsCount > 0 && (
                <Link
                  href="/site-capture"
                  className="notif-footer-link"
                  onClick={() => setOpen(false)}
                >
                  GPS capture list
                </Link>
              )}
              {mdCount > 0 && (
                <Link
                  href="/quotations"
                  className="notif-footer-link"
                  onClick={() => setOpen(false)}
                >
                  Quotations for MD
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
