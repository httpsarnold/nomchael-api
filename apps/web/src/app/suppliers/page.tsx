'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    company: '',
    phone: '',
    address: '',
    locationLat: '',
    locationLng: '',
  });
  const [priceForm, setPriceForm] = useState({
    supplierId: '',
    itemName: '',
    unit: 'bags',
    unitPrice: '',
    company: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    const [s, p] = await Promise.all([api('/suppliers'), api('/suppliers/prices')]);
    setSuppliers(s as any[]);
    setPrices(p as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function saveSupplier(e: FormEvent) {
    e.preventDefault();
    await api('/suppliers', {
      method: 'POST',
      body: JSON.stringify({
        ...supplierForm,
        locationLat: supplierForm.locationLat ? Number(supplierForm.locationLat) : undefined,
        locationLng: supplierForm.locationLng ? Number(supplierForm.locationLng) : undefined,
      }),
    });
    setSupplierForm({
      name: '',
      company: '',
      phone: '',
      address: '',
      locationLat: '',
      locationLng: '',
    });
    await load();
  }

  async function savePrice(e: FormEvent) {
    e.preventDefault();
    await api('/suppliers/prices', {
      method: 'POST',
      body: JSON.stringify({
        supplierId: priceForm.supplierId,
        itemName: priceForm.itemName,
        unit: priceForm.unit,
        unitPriceCents: Math.round(Number(priceForm.unitPrice) * 100),
        company: priceForm.company,
      }),
    });
    setPriceForm({ supplierId: '', itemName: '', unit: 'bags', unitPrice: '', company: '' });
    await load();
  }

  return (
    <AppShell>
      <h1>Suppliers & price book</h1>
      <p className="muted">Record cheap supplier prices and locations for optimization</p>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading suppliers…" />}
      {!loading && (
      <>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Add supplier</h3>
          <form className="form" onSubmit={saveSupplier}>
            <label>
              Name
              <input
                required
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </label>
            <label>
              Company
              <input
                value={supplierForm.company}
                onChange={(e) => setSupplierForm({ ...supplierForm, company: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              />
            </label>
            <label>
              Base address / area
              <input
                value={supplierForm.address}
                onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
              />
            </label>
            <div className="grid grid-2">
              <label>
                Lat
                <input
                  value={supplierForm.locationLat}
                  onChange={(e) => setSupplierForm({ ...supplierForm, locationLat: e.target.value })}
                />
              </label>
              <label>
                Lng
                <input
                  value={supplierForm.locationLng}
                  onChange={(e) => setSupplierForm({ ...supplierForm, locationLng: e.target.value })}
                />
              </label>
            </div>
            <button className="btn" type="submit">
              Save supplier
            </button>
          </form>
        </div>

        <div className="panel">
          <h3>Record observed price</h3>
          <form className="form" onSubmit={savePrice}>
            <label>
              Supplier
              <select
                required
                value={priceForm.supplierId}
                onChange={(e) => setPriceForm({ ...priceForm, supplierId: e.target.value })}
              >
                <option value="">Select…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Item
              <input
                required
                value={priceForm.itemName}
                onChange={(e) => setPriceForm({ ...priceForm, itemName: e.target.value })}
                placeholder="Cement 50kg"
              />
            </label>
            <div className="grid grid-2">
              <label>
                Unit
                <input
                  value={priceForm.unit}
                  onChange={(e) => setPriceForm({ ...priceForm, unit: e.target.value })}
                />
              </label>
              <label>
                Unit price
                <input
                  required
                  value={priceForm.unitPrice}
                  onChange={(e) => setPriceForm({ ...priceForm, unitPrice: e.target.value })}
                />
              </label>
            </div>
            <label>
              Company / store name
              <input
                value={priceForm.company}
                onChange={(e) => setPriceForm({ ...priceForm, company: e.target.value })}
              />
            </label>
            <button className="btn" type="submit">
              Save price
            </button>
          </form>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Recent prices</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Supplier</th>
                <th>Company</th>
                <th>Price</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.itemName} / {p.unit}
                  </td>
                  <td>{p.supplier?.name}</td>
                  <td>{p.company || p.supplier?.company}</td>
                  <td>{money(p.unitPriceCents)}</td>
                  <td>{p.supplier?.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </AppShell>
  );
}
