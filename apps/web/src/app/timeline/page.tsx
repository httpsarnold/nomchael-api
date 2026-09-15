'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { BusyOverlay, LoadingState, SavePulse } from '@/components/LoadingState';
import { ProgrammeGantt, labourPriorityRows } from '@/components/ProgrammeGantt';
import { ProjectProgressVisual } from '@/components/ProjectProgressVisual';
import { api, money } from '@/lib/api';

function dayInput(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

export default function TimelinePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [lagging, setLagging] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState('');
  const [projectPlan, setProjectPlan] = useState({ start: '', end: '' });
  const [assignForm, setAssignForm] = useState({ employeeId: '', dailyWage: '' });

  async function load() {
    const [schedule, behind, staff] = await Promise.all([
      api('/projects/schedule'),
      api('/projects/lagging'),
      api('/employees'),
    ]);
    setRows(schedule as any[]);
    setLagging(behind as any[]);
    setEmployees((staff as any[]).filter((e) => e.isActive !== false));
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URLSearchParams(window.location.search).get('projectId');
    if (fromUrl) setSelectedId(fromUrl);
  }, []);

  const labourQueue = useMemo(() => labourPriorityRows(rows), [rows]);
  const overlappingCount = useMemo(
    () => labourQueue.filter((p) => p.overlaps).length,
    [labourQueue],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const row = rows.find((r) => r.id === selectedId);
    setDetail(row || null);
    setProjectPlan({
      start: dayInput(row?.plannedStartAt),
      end: dayInput(row?.plannedEndAt),
    });
  }, [selectedId, rows]);

  async function saveProjectPlan(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${selectedId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedStartAt: projectPlan.start || null,
          plannedEndAt: projectPlan.end || null,
        }),
      });
      setSavedFlash('Project timeline saved');
      window.setTimeout(() => setSavedFlash(''), 2400);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveStagePlan(
    stageId: string,
    plannedStartAt: string,
    plannedEndAt: string,
  ) {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${selectedId}/stages/${stageId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedStartAt: plannedStartAt || null,
          plannedEndAt: plannedEndAt || null,
        }),
      });
      setSavedFlash('Stage timeline saved');
      window.setTimeout(() => setSavedFlash(''), 2400);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assignPerson(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !assignForm.employeeId) return;
    setBusy(true);
    setError('');
    try {
      const emp = employees.find((x) => x.id === assignForm.employeeId);
      await api('/employees/assign', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedId,
          employeeId: assignForm.employeeId,
          dailyWageCents: Math.round(
            Number(assignForm.dailyWage || Number(emp?.dailyWageCents || 0) / 100) * 100,
          ),
        }),
      });
      setAssignForm({ employeeId: '', dailyWage: '' });
      setSavedFlash('Person attached to project');
      window.setTimeout(() => setSavedFlash(''), 2400);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const assignedIds = new Set((detail?.people || []).map((p: any) => p.employeeId));
  const availableStaff = employees.filter((e) => !assignedIds.has(e.id));

  return (
    <AppShell>
      {busy && <BusyOverlay label="Saving timelineâ€¦" />}
      <h1>Project timeline</h1>
      <p className="muted">
        All projects on one Gantt. Rows are ordered by deadline so you can see which job must finish
        earlier when allocating labour. Overlapping bars show date clashes.
      </p>
      {error && <p className="error">{error}</p>}
      {savedFlash && <SavePulse label={savedFlash} />}
      {loading && <LoadingState label="Loading scheduleâ€¦" />}

      {!loading && (
        <>
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Programme Gantt Â· all projects</h3>
            <ProgrammeGantt rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Labour allocation order</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Finish earlier deadlines first. {overlappingCount} project
              {overlappingCount === 1 ? '' : 's'} currently overlap on dates.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Project</th>
                    <th>Deadline</th>
                    <th>People</th>
                    <th>Overlap</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {labourQueue.map((p) => (
                    <tr
                      key={p.id}
                      style={{ cursor: 'pointer' }}
                      className={selectedId === p.id ? 'row-selected' : undefined}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <td>
                        {p.labourRank != null ? (
                          <span className="gantt-priority-badge">#{p.labourRank}</span>
                        ) : (
                          <span className="muted">â€”</span>
                        )}
                      </td>
                      <td>
                        {p.code} {p.name}
                      </td>
                      <td>
                        {p.deadline
                          ? p.deadline.toLocaleDateString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : 'No deadline'}
                      </td>
                      <td>{(p.people || []).length || 'â€”'}</td>
                      <td>
                        {p.overlaps ? (
                          <span className="badge danger">
                            {p.overlapsWith.slice(0, 2).join(', ')}
                            {p.overlapsWith.length > 2 ? 'â€¦' : ''}
                          </span>
                        ) : (
                          <span className="muted">None</span>
                        )}
                      </td>
                      <td>
                        {p.projectStatus === 'LAGGING' ? (
                          <span className="badge danger">{p.projectDaysBehind}d behind</span>
                        ) : p.projectStatus === 'ON_TRACK' ? (
                          <span className="badge ok">On track</span>
                        ) : (
                          <span className="muted">{p.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!labourQueue.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No projects on the programme yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3>Lagging projects</h3>
            {!lagging.length ? (
              <p className="muted">No projects are behind their planned dates right now.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Client</th>
                      <th>Days behind</th>
                      <th>Lagging stages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lagging.map((p) => (
                      <tr
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedId(p.id)}
                      >
                        <td>
                          {p.code} {p.name}
                        </td>
                        <td>{p.client?.name}</td>
                        <td>
                          <span className="badge danger">{p.projectDaysBehind}d</span>
                        </td>
                        <td>{p.laggingStageCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <div className="panel">
              <h3>
                {detail ? `People on ${detail.code}` : 'People on selected project'}
              </h3>
              {!detail ? (
                <p className="muted">Select a project on the Gantt to see and attach staff.</p>
              ) : (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>From</th>
                          <th>Days</th>
                          <th>Wage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.people || []).map((person: any) => (
                          <tr key={person.assignmentId}>
                            <td>{person.fullName}</td>
                            <td>{person.roleTitle || 'â€”'}</td>
                            <td>
                              {person.startDate
                                ? new Date(person.startDate).toLocaleDateString()
                                : 'â€”'}
                            </td>
                            <td>{person.daysWorked ?? 0}</td>
                            <td>{money(person.dailyWageCents || 0)}</td>
                          </tr>
                        ))}
                        {!(detail.people || []).length && (
                          <tr>
                            <td colSpan={5} className="muted">
                              No employees attached yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <form className="form" onSubmit={assignPerson} style={{ marginTop: '1rem' }}>
                    <label>
                      Attach employee
                      <select
                        required
                        value={assignForm.employeeId}
                        onChange={(e) => {
                          const emp = employees.find((x) => x.id === e.target.value);
                          setAssignForm({
                            employeeId: e.target.value,
                            dailyWage: emp
                              ? String(Number(emp.dailyWageCents || 0) / 100)
                              : '',
                          });
                        }}
                      >
                        <option value="">Selectâ€¦</option>
                        {availableStaff.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.fullName}
                            {e.roleTitle ? ` Â· ${e.roleTitle}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Daily wage (USD)
                      <input
                        value={assignForm.dailyWage}
                        onChange={(e) =>
                          setAssignForm({ ...assignForm, dailyWage: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="btn"
                      type="submit"
                      disabled={busy || !assignForm.employeeId}
                    >
                      Attach to {detail.code}
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="panel">
              <h3>{detail ? `Plan ${detail.code}` : 'Plan selected project'}</h3>
              {!detail ? (
                <p className="muted">Select a project from the Gantt or labour order list.</p>
              ) : (
                <>
                  <p>
                    <Link href={`/projects/${detail.id}`}>
                      {detail.code} {detail.name}
                    </Link>
                  </p>
                  {(detail.siteVisits || []).length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem' }}>Site visits</h4>
                      <ul className="muted" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                        {detail.siteVisits.map((v: any) => (
                          <li key={v.id}>
                            {v.code}
                            {v.scheduledAt
                              ? ` Â· ${new Date(v.scheduledAt).toLocaleString(undefined, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}`
                              : ' Â· date/time not set'}{' '}
                            Â· {v.status}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <ProjectProgressVisual
                      compact
                      projectCode={detail.code}
                      plannedStartAt={detail.plannedStartAt}
                      plannedEndAt={detail.plannedEndAt}
                      stages={(detail.stages || []).map((s: any) => ({
                        ...s,
                        isCompleted: s.status === 'DONE' || s.isCompleted,
                      }))}
                    />
                  </div>
                  <form className="form" onSubmit={saveProjectPlan}>
                    <label>
                      Project planned start
                      <input
                        type="date"
                        value={projectPlan.start}
                        onChange={(e) =>
                          setProjectPlan({ ...projectPlan, start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Project planned end
                      <input
                        type="date"
                        value={projectPlan.end}
                        onChange={(e) =>
                          setProjectPlan({ ...projectPlan, end: e.target.value })
                        }
                      />
                    </label>
                    <button className="btn" type="submit" disabled={busy}>
                      Save project dates
                    </button>
                  </form>

                  <h3 style={{ marginTop: '1.25rem' }}>Stages</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.stages?.map((s: any) => (
                          <StagePlanRow
                            key={s.id}
                            stage={s}
                            busy={busy}
                            onSave={saveStagePlan}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
function StagePlanRow({
  stage,
  busy,
  onSave,
}: {
  stage: any;
  busy: boolean;
  onSave: (id: string, start: string, end: string) => void;
}) {
  const [start, setStart] = useState(dayInput(stage.plannedStartAt));
  const [end, setEnd] = useState(dayInput(stage.plannedEndAt));

  useEffect(() => {
    setStart(dayInput(stage.plannedStartAt));
    setEnd(dayInput(stage.plannedEndAt));
  }, [stage.plannedStartAt, stage.plannedEndAt]);

  return (
    <tr>
      <td>{stage.name}</td>
      <td>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </td>
      <td>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </td>
      <td>
        {stage.status === 'LAGGING' ? (
          <span className="badge danger">{stage.daysBehind}d behind</span>
        ) : stage.status === 'DONE' ? (
          <span className="badge ok">Done</span>
        ) : stage.status === 'ON_TRACK' ? (
          <span className="badge ok">On track</span>
        ) : (
          <span className="muted">â€”</span>
        )}
      </td>
      <td>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => onSave(stage.id, start, end)}
        >
          Save
        </button>
      </td>
    </tr>
  );
}
