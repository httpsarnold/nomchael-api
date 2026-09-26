'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState } from '@/components/LoadingState';
import { api, downloadFile, money } from '@/lib/api';

export default function EstatesPage() {
  const [estates, setEstates] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    houseCount: '40',
    baseLabour: '',
    address: '',
    description: '',
  });

  async function load() {
    setEstates(await api('/estates'));
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await api<any>('/estates', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          houseCount: Number(form.houseCount),
          baseLabourCents: Math.round(Number(form.baseLabour) * 100),
          address: form.address || undefined,
          description: form.description || undefined,
        }),
      });
      setForm({ name: '', houseCount: '40', baseLabour: '', address: '', description: '' });
      await load();
      window.location.href = `/estates/${created.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      {saving && <BusyOverlay label={`Creating ${form.houseCount || ''} houses…`} />}
      <h1>Estates</h1>
      <p className="muted">
        Big files for many houses with different owners. Shared base labour profit, then manage money
        per house or in bulk.
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading estates…" />}
      {!loading && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="panel">
            <h3>Create estate</h3>
            <form className="form" onSubmit={onCreate}>
              <label>
                Estate name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. YEA"
                />
              </label>
              <label>
                Number of houses
                <input
                  required
                  type="number"
                  min="1"
                  max="500"
                  value={form.houseCount}
                  onChange={(e) => setForm({ ...form, houseCount: e.target.value })}
                />
              </label>
              <label>
                Base labour per house
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.baseLabour}
                  onChange={(e) => setForm({ ...form, baseLabour: e.target.value })}
                />
              </label>
              <label>
                Address / location
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>
              <label>
                Notes
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <p className="muted">
                Each house gets its own owner placeholder. Rename owners from the estate file or
                Clients page.
              </p>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Creating…' : 'Create estate file'}
              </button>
            </form>
          </div>
          <div className="panel">
            <h3>Estate files</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Estate</th>
                    <th>Houses</th>
                    <th>Net due</th>
                    <th>Cash in</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {estates.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.code}
                        <div className="muted">{e.name}</div>
                      </td>
                      <td>{e.trends?.houseCount ?? e.houseCount}</td>
                      <td>{money(e.trends?.netDueCents || 0)}</td>
                      <td>{money(e.trends?.cashReceivedCents || 0)}</td>
                      <td>
                        <Link href={`/estates/${e.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                  {!estates.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No estates yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: '0.75rem' }}>
              <Link href="/bulk-labour">Bulk Labour</Link> applies the same amount to selected houses.
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
