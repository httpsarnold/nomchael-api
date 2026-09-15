'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearAuth, getUser, type AuthUser } from '@/lib/api';
import { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';

type NavItem = { href: string; label: string; match?: (path: string) => boolean };
type NavGroup = { id: string; label: string; summary: string; items: NavItem[] };

const primary: (NavItem & { icon: string })[] = [
  {
    href: '/dashboard',
    label: 'Home',
    icon: '⌂',
    match: (p) => p === '/dashboard',
  },
  {
    href: '/projects',
    label: 'All Projects',
    icon: '▦',
    match: (p) => p.startsWith('/projects'),
  },
];

const groups: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    summary: 'Overview',
    items: [
      { href: '/dashboard', label: 'Portfolio Analytics', match: (p) => p === '/dashboard' },
      { href: '/open-project', label: 'Open a project' },
      { href: '/site-visits', label: 'Site visits' },
      { href: '/quotations', label: 'Quotations' },
      { href: '/timeline', label: 'Project timeline' },
      { href: '/catalog', label: 'Material prices' },
      { href: '/clients', label: 'Clients' },
      { href: '/employees', label: 'Staff & Labour' },
      { href: '/map', label: 'Project Map' },
      { href: '/site-capture', label: 'Capture GPS on site' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    summary: 'General',
    items: [
      { href: '/finance', label: 'Finance desk' },
      { href: '/suppliers', label: 'Suppliers & Creditors' },
      { href: '/stock', label: 'Stores & Stock' },
      { href: '/reports', label: 'Reports & Statements' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    summary: 'General',
    items: [{ href: '/admin/users', label: 'Users & Levels' }],
  },
];

function isActive(item: NavItem, pathname: string) {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    operations: true,
    finance: true,
    admin: false,
  });

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
  }, [router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  function logout() {
    clearAuth();
    router.replace('/login');
  }

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <div
        className="sidebar-backdrop"
        aria-hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
      />
      <aside className="sidebar" id="app-sidebar">
        <div className="brand">
          <div className="brand-mark">NC</div>
          <div>
            <strong>Nomchael Construction</strong>
            <span>ERP Zimbabwe</span>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            ✕
          </button>
        </div>

        {primary.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className={`nav-link ${isActive(l, pathname) ? 'active' : ''}`}
          >
            <span className="icon">{l.icon}</span>
            {l.label}
          </Link>
        ))}

        {groups.map((g) => (
          <div key={g.id}>
            <div className="nav-section-label">{g.label}</div>
            <button
              type="button"
              className={`nav-group-btn ${open[g.id] ? 'open' : ''}`}
              onClick={() => setOpen((s) => ({ ...s, [g.id]: !s[g.id] }))}
            >
              <span>{g.summary}</span>
              <span className="chevron">›</span>
            </button>
            {open[g.id] && (
              <div className="nav-sub">
                {g.items.map((item) => (
                  <Link
                    key={`${g.id}-${item.href}-${item.label}`}
                    href={item.href}
                    className={`nav-link ${isActive(item, pathname) ? 'active' : ''}`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            title="Menu"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar-actions">
            <NotificationBell />
            {user && (
              <div className="user-chip">
                <div className="user-avatar">{initials(user.fullName)}</div>
                <div className="user-text">
                  <strong>{user.fullName}</strong>
                  <span>{user.email.split('@')[0]}</span>
                </div>
                <button type="button" className="logout-link" onClick={logout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="main">
          {children}
          <footer className="page-footer">
            Nomchael Construction ERP · © 2026 · Site, finance and workforce control
          </footer>
        </main>
      </div>
    </div>
  );
}
