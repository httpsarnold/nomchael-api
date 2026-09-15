'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api } from '@/lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'SITE_CLERK',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setUsers(await api('/users'));
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function register(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/register', { method: 'POST', body: JSON.stringify(form) });
      setForm({ email: '', password: '', fullName: '', role: 'SITE_CLERK' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell>
      <h1>Users & levels</h1>
      <p className="muted">System users and role levels</p>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading users…" />}
      {!loading && (
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Create user</h3>
          <form className="form" onSubmit={register}>
            <label>
              Full name
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              Role / level
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="MANAGING_DIRECTOR">Managing Director</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="PROJECT_MANAGER">Project Manager</option>
                <option value="SITE_CLERK">Site Clerk</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </label>
            <button className="btn" type="submit">
              Create
            </button>
          </form>
        </div>
        <div className="panel">
          <h3>Directory</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.fullName}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge">{u.role}</span>
                    </td>
                    <td>{u.isActive ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}
    </AppShell>
  );
}
