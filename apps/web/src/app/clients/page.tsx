'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

type Client = {
  id: string;
  name: string;
  phone: string;
  whatsapp?: string;
  address?: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  contactPerson?: string;
  registrationNo?: string;
  balanceCents?: number;
  _count?: { projects: number; standPackages: number };
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    whatsapp: '',
    address: '',
    email: '',
    type: 'INDIVIDUAL' as 'INDIVIDUAL' | 'COMPANY',
    contactPerson: '',
    registrationNo: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  async function load(q = search) {
    const path = q.trim() ? `/clients?q=${encodeURIComponent(q.trim())}` : '/clients';
    setClients(await api(path));
  }

  useEffect(() => {
    setLoading(true);
    load('')
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load(search).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/clients', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          contactPerson: form.contactPerson || undefined,
          registrationNo: form.registrationNo || undefined,
        }),
      });
      setForm({
        name: '',
        phone: '',
        whatsapp: '',
        address: '',
        email: '',
        type: 'INDIVIDUAL',
        contactPerson: '',
        registrationNo: '',
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1>Clients</h1>
      <p className="muted">
        Browse people and companies. To open a job for someone new, add them on{' '}
        <Link href="/projects">All Projects</Link> when you register the project (file opens later
        after the client agrees). Use this page for
        company stand packages and account history.
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading clients…" />}
      {!loading && (
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Add client</h3>
          <form className="form" onSubmit={onSubmit}>
            <label>
              Client type
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    type: e.target.value as 'INDIVIDUAL' | 'COMPANY',
                  })
                }
              >
                <option value="INDIVIDUAL">Person</option>
                <option value="COMPANY">Company</option>
              </select>
            </label>
            <label>
              {form.type === 'COMPANY' ? 'Company name' : 'Name'}
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            {form.type === 'COMPANY' && (
              <>
                <label>
                  Contact person
                  <input
                    value={form.contactPerson}
                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  />
                </label>
                <label>
                  Registration no.
                  <input
                    value={form.registrationNo}
                    onChange={(e) => setForm({ ...form, registrationNo: e.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              Phone / WhatsApp
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              WhatsApp (if different)
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save client'}
            </button>
          </form>
        </div>
        <div className="panel">
          <h3>All clients</h3>
          <label style={{ display: 'block', marginBottom: 12 }}>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, email, registration…"
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Phone</th>
                  <th>Projects</th>
                  <th>Packages</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.type === 'COMPANY' ? 'Company' : 'Person'}</td>
                    <td>{c.whatsapp || c.phone}</td>
                    <td>{c._count?.projects || 0}</td>
                    <td>{c._count?.standPackages || 0}</td>
                    <td>{money(c.balanceCents || 0)}</td>
                  </tr>
                ))}
                {!clients.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {search.trim() ? `No clients match “${search.trim()}”` : 'No clients yet'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}
    </AppShell>
  );
}
