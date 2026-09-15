'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  category?: string | null;
  description?: string | null;
  defaultUnitPriceCents: number;
  isActive: boolean;
};

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    unit: 'bags',
    category: 'General',
    defaultUnitPrice: '',
    description: '',
  });
  const [editId, setEditId] = useState('');
  const [editPrice, setEditPrice] = useState('');

  async function load(search = q) {
    const path = search.trim()
      ? `/catalog?q=${encodeURIComponent(search.trim())}&activeOnly=false`
      : '/catalog?activeOnly=false';
    setItems(await api<CatalogItem[]>(path));
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/catalog', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          unit: form.unit,
          category: form.category || undefined,
          description: form.description || undefined,
          defaultUnitPriceCents: Math.round(Number(form.defaultUnitPrice) * 100),
        }),
      });
      setForm({
        name: '',
        unit: 'bags',
        category: 'General',
        defaultUnitPrice: '',
        description: '',
      });
      setInfo('Catalog item added. It will appear as a default when building quotations.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function savePrice(id: string) {
    setError('');
    try {
      await api(`/catalog/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          defaultUnitPriceCents: Math.round(Number(editPrice) * 100),
        }),
      });
      setEditId('');
      setEditPrice('');
      setInfo('Default catalog price updated. Existing quotations keep their own line prices.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleActive(item: CatalogItem) {
    await api(`/catalog/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    await load();
  }

  return (
    <AppShell>
      <h1>Material price catalog</h1>
      <p className="muted">
        Company defaults for quoting. Import these into any quotation. Change a price on a quote
        without changing the catalog. Add new materials here when needed.
      </p>
      {error && <p className="error">{error}</p>}
      {info && (
        <div className="info-banner" style={{ marginTop: '0.75rem', borderColor: '#16a34a' }}>
          <span>✓</span>
          <span>{info}</span>
        </div>
      )}
      {loading && <LoadingState label="Loading catalog…" />}
      {!loading && (
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Add material</h3>
          <form className="form" onSubmit={addItem}>
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Cement 50kg"
              />
            </label>
            <div className="grid grid-3">
              <label>
                Unit
                <input
                  required
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </label>
              <label>
                Category
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </label>
              <label>
                Default price
                <input
                  required
                  value={form.defaultUnitPrice}
                  onChange={(e) => setForm({ ...form, defaultUnitPrice: e.target.value })}
                  placeholder="0.00"
                />
              </label>
            </div>
            <label>
              Notes
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <button className="btn" type="submit">
              Save to catalog
            </button>
          </form>
        </div>

        <div className="panel">
          <h3>Defaults in use</h3>
          <label>
            Search
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load().catch((err) => setError(err.message));
              }}
              placeholder="Cement, brick, paint…"
            />
          </label>
          <button
            className="btn secondary"
            type="button"
            style={{ marginTop: 8 }}
            onClick={() => load().catch((err) => setError(err.message))}
          >
            Search
          </button>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  <th>Default</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ opacity: item.isActive ? 1 : 0.5 }}>
                    <td>
                      <div>{item.name}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {item.category || 'General'}
                      </div>
                    </td>
                    <td>{item.unit}</td>
                    <td>
                      {editId === item.id ? (
                        <div className="row-actions">
                          <input
                            style={{ width: 90 }}
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                          />
                          <button className="btn" type="button" onClick={() => savePrice(item.id)}>
                            Save
                          </button>
                        </div>
                      ) : (
                        money(item.defaultUnitPriceCents)
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => {
                            setEditId(item.id);
                            setEditPrice((Number(item.defaultUnitPriceCents) / 100).toFixed(2));
                          }}
                        >
                          Edit price
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => toggleActive(item)}
                        >
                          {item.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No catalog items yet. Run seed or add materials above.
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
