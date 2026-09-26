'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearAuth, getUser, type AuthUser } from '@/lib/api';
import { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';

type NavItem = {
  href: string;
  label: string;
  match?: (path: string) => boolean;
  locked?: boolean;
};
type NavGroup = { id: string; label: string; summary: string; items: NavItem[] };

/** Estate catch-up mode: only Labour revenue + Reports stay clickable. */
const ESTATE_FOCUS_MODE = true;

const primary: (NavItem & { icon: string })[] = [
  {
    href: '/dashboard',
    label: 'Home',
    icon: '⌂',
    match: (p) => p === '/dashboard',
    locked: ESTATE_FOCUS_MODE,
  },
  {
    href: '/projects',
    label: 'All Projects',
    icon: '▦',
    match: (p) => p.startsWith('/projects'),
    locked: ESTATE_FOCUS_MODE,
  },
];

const groups: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    summary: 'Overview',
    items: [
      { href: '/dashboard', label: 'Portfolio Analytics', match: (p) => p === '/dashboard', locked: ESTATE_FOCUS_MODE },
      { href: '/open-project', label: 'Open a project', locked: ESTATE_FOCUS_MODE },
      { href: '/site-visits', label: 'Site visits', locked: ESTATE_FOCUS_MODE },
      { href: '/quotations', label: 'Quotations', locked: ESTATE_FOCUS_MODE },
      { href: '/timeline', label: 'Project timeline', locked: ESTATE_FOCUS_MODE },
      { href: '/catalog', label: 'Material prices', locked: ESTATE_FOCUS_MODE },
      { href: '/clients', label: 'Clients', locked: ESTATE_FOCUS_MODE },
      { href: '/employees', label: 'Staff & Labour', locked: ESTATE_FOCUS_MODE },
      { href: '/map', label: 'Project Map', locked: ESTATE_FOCUS_MODE },
      { href: '/site-capture', label: 'Capture GPS on site', locked: ESTATE_FOCUS_MODE },
    ],
  },
  {
    id: 'labour-revenue',
    label: 'Labour revenue',
    summary: 'Estates',
    items: [
      { href: '/labour-catchup', label: 'Labour catch-up' },
      { href: '/estates', label: 'Estates' },
      { href: '/bulk-labour', label: 'Bulk Labour' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    summary: 'General',
    items: [
      { href: '/finance', label: 'Finance desk', locked: ESTATE_FOCUS_MODE },
      { href: '/suppliers', label: 'Suppliers & Creditors', locked: ESTATE_FOCUS_MODE },
      { href: '/stock', label: 'Stores & Stock', locked: ESTATE_FOCUS_MODE },
      { href: '/reports', label: 'Reports & Statements' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    summary: 'General',
    items: [{ href: '/admin/users', label: 'Users & Levels', locked: ESTATE_FOCUS_MODE }],
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

function NavLinkItem({
  item,
  pathname,
  icon,
}: {
  item: NavItem;
  pathname: string;
  icon?: string;
}) {
  const active = isActive(item, pathname);
  if (item.locked) {
    return (
      <span
        className={`nav-link locked ${active ? 'active' : ''}`}
        title="Locked while using Estates catch-up"
        aria-disabled="true"
      >
        {icon ? <span className="icon">{icon}</span> : null}
        {item.label}
        <span className="nav-lock">Locked</span>
      </span>
    );
  }
  return (
    <Link href={item.href} className={`nav-link ${active ? 'active' : ''}`}>
      {icon ? <span className="icon">{icon}</span> : null}
      {item.label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({
    operations: false,
    'labour-revenue': true,
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

        {ESTATE_FOCUS_MODE && (
          <p className="nav-focus-note">
            Estate catch-up mode: only Labour revenue and Reports are open.
          </p>
        )}

        {primary.map((l) => (
          <NavLinkItem key={l.label} item={l} pathname={pathname} icon={l.icon} />
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
                  <NavLinkItem
                    key={`${g.id}-${item.href}-${item.label}`}
                    item={item}
                    pathname={pathname}
                  />
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
