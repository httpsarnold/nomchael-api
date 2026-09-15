'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';
import { api, money } from '@/lib/api';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({ fullName: '', phone: '', roleTitle: '', dailyWage: '' });
  const [assign, setAssign] = useState({
    projectId: '',
    employeeId: '',
    daysWorked: '1',
    dailyWage: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    const [e, p] = await Promise.all([api('/employees'), api('/projects')]);
    setEmployees(e as any[]);
    setProjects(p as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await api('/employees', {
      method: 'POST',
      body: JSON.stringify({
        fullName: form.fullName,
        phone: form.phone,
        roleTitle: form.roleTitle,
        dailyWageCents: Math.round(Number(form.dailyWage || 0) * 100),
      }),
    });
    setForm({ fullName: '', phone: '', roleTitle: '', dailyWage: '' });
    await load();
  }

  async function assignStaff(e: FormEvent) {
    e.preventDefault();
    await api('/employees/assign', {
      method: 'POST',
      body: JSON.stringify({
        projectId: assign.projectId,
        employeeId: assign.employeeId,
        daysWorked: Number(assign.daysWorked),
        dailyWageCents: assign.dailyWage
          ? Math.round(Number(assign.dailyWage) * 100)
          : undefined,
      }),
    });
    setAssign({ projectId: '', employeeId: '', daysWorked: '1', dailyWage: '' });
    await load();
  }

  return (
    <AppShell>
      <h1>Employees</h1>
      <p className="muted">Wage database and project labour assignments</p>
      {error && <p className="error">{error}</p>}
      {loading && <LoadingState label="Loading employees…" />}
      {!loading && (
      <>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h3>Add employee</h3>
          <form className="form" onSubmit={create}>
            <label>
              Full name
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              Role / trade
              <input
                value={form.roleTitle}
                onChange={(e) => setForm({ ...form, roleTitle: e.target.value })}
              />
            </label>
            <label>
              Daily wage
              <input
                value={form.dailyWage}
                onChange={(e) => setForm({ ...form, dailyWage: e.target.value })}
              />
            </label>
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </div>
        <div className="panel">
          <h3>Assign to project</h3>
          <form className="form" onSubmit={assignStaff}>
            <label>
              Employee
              <select
                required
                value={assign.employeeId}
                onChange={(e) => setAssign({ ...assign, employeeId: e.target.value })}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({money(emp.dailyWageCents)}/day)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                required
                value={assign.projectId}
                onChange={(e) => setAssign({ ...assign, projectId: e.target.value })}
              >
                <option value="">Select…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Days worked
              <input
                value={assign.daysWorked}
                onChange={(e) => setAssign({ ...assign, daysWorked: e.target.value })}
              />
            </label>
            <button className="btn" type="submit">
              Assign
            </button>
          </form>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3>Staff directory</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Daily wage</th>
                <th>Assignments</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>{emp.fullName}</td>
                  <td>{emp.roleTitle}</td>
                  <td>{money(emp.dailyWageCents)}</td>
                  <td>{emp.assignments?.length || 0}</td>
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
