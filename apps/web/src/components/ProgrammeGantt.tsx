'use client';

import { useMemo } from 'react';

type Visit = {
  id: string;
  code: string;
  status: string;
  scheduledAt?: string | null;
};

type Stage = {
  id: string;
  name: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  status?: string;
  daysBehind?: number;
};

type Person = {
  assignmentId: string;
  employeeId: string;
  fullName: string;
  roleTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  projectStatus?: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  stages?: Stage[];
  siteVisits?: Visit[];
  people?: Person[];
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayIndex(rangeStart: Date, when: Date) {
  return Math.round((startOfDay(when).getTime() - rangeStart.getTime()) / 86400000);
}

function pct(leftDays: number, widthDays: number, totalDays: number) {
  const left = Math.max(0, Math.min(100, (leftDays / totalDays) * 100));
  const width = Math.max(0.8, Math.min(100 - left, (Math.max(widthDays, 0.5) / totalDays) * 100));
  return { left: `${left}%`, width: `${width}%` };
}

function windowOf(p: ProjectRow): { start: Date; end: Date } | null {
  if (p.plannedStartAt && p.plannedEndAt) {
    return { start: new Date(p.plannedStartAt), end: new Date(p.plannedEndAt) };
  }
  const stageStarts = (p.stages || [])
    .map((s) => (s.plannedStartAt ? new Date(s.plannedStartAt) : null))
    .filter(Boolean) as Date[];
  const stageEnds = (p.stages || [])
    .map((s) => (s.plannedEndAt ? new Date(s.plannedEndAt) : null))
    .filter(Boolean) as Date[];
  if (!stageStarts.length || !stageEnds.length) return null;
  return {
    start: new Date(Math.min(...stageStarts.map((d) => d.getTime()))),
    end: new Date(Math.max(...stageEnds.map((d) => d.getTime()))),
  };
}

function rangesOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }) {
  return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
}

/** Earliest deadline first, for labour allocation. */
export function sortByLabourDeadline(rows: ProjectRow[]) {
  return [...rows].sort((a, b) => {
    const aw = windowOf(a);
    const bw = windowOf(b);
    if (aw && bw) return aw.end.getTime() - bw.end.getTime();
    if (aw) return -1;
    if (bw) return 1;
    return String(a.code).localeCompare(String(b.code));
  });
}

export function labourPriorityRows(rows: ProjectRow[]) {
  const ordered = sortByLabourDeadline(rows);
  const windows = new Map<string, { start: Date; end: Date }>();
  for (const p of ordered) {
    const w = windowOf(p);
    if (w) windows.set(p.id, w);
  }
  return ordered.map((p, index) => {
    const w = windows.get(p.id) || null;
    const overlapsWith = ordered
      .filter((other) => {
        if (other.id === p.id) return false;
        const ow = windows.get(other.id);
        return !!(w && ow && rangesOverlap(w, ow));
      })
      .map((o) => o.code);
    return {
      ...p,
      labourRank: w ? index + 1 : null,
      deadline: w?.end || null,
      window: w,
      overlapsWith,
      overlaps: overlapsWith.length > 0,
    };
  });
}

export function ProgrammeGantt({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ProjectRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const ranked = useMemo(() => labourPriorityRows(rows), [rows]);

  const { rangeStart, totalDays, ticks, todayLeft } = useMemo(() => {
    const dates: Date[] = [];
    for (const p of ranked) {
      if (p.window) {
        dates.push(p.window.start);
        dates.push(p.window.end);
      }
      for (const s of p.stages || []) {
        if (s.plannedStartAt) dates.push(new Date(s.plannedStartAt));
        if (s.plannedEndAt) dates.push(new Date(s.plannedEndAt));
      }
      for (const v of p.siteVisits || []) {
        if (v.scheduledAt) dates.push(new Date(v.scheduledAt));
      }
    }
    const now = startOfDay(new Date());
    if (!dates.length) {
      const start = addDays(now, -7);
      return {
        rangeStart: start,
        totalDays: 42,
        ticks: Array.from({ length: 7 }, (_, i) => addDays(start, i * 7)),
        todayLeft: (dayIndex(start, now) / 42) * 100,
      };
    }
    const min = startOfDay(new Date(Math.min(...dates.map((d) => d.getTime()))));
    const max = startOfDay(new Date(Math.max(...dates.map((d) => d.getTime()))));
    const start = addDays(min, -3);
    const end = addDays(max, 10);
    const days = Math.max(14, dayIndex(start, end) + 1);
    const step = days > 60 ? 14 : days > 30 ? 7 : 3;
    const tickList: Date[] = [];
    for (let i = 0; i <= days; i += step) tickList.push(addDays(start, i));
    return {
      rangeStart: start,
      totalDays: days,
      ticks: tickList,
      todayLeft: (dayIndex(start, now) / days) * 100,
    };
  }, [ranked]);

  if (!rows.length) {
    return <p className="muted">No projects on the programme yet.</p>;
  }

  return (
    <div className="gantt">
      <div className="gantt-legend">
        <span>
          <i className="gantt-swatch project" /> Project window
        </span>
        <span>
          <i className="gantt-swatch deadline" /> Deadline
        </span>
        <span>
          <i className="gantt-swatch overlap" /> Overlap (labour clash)
        </span>
        <span>
          <i className="gantt-swatch today" /> Today
        </span>
        <span>
          <i className="gantt-swatch lagging" /> Behind plan
        </span>
        <span>
          <i className="gantt-swatch people" /> People
        </span>
      </div>
      <p className="muted gantt-hint">
        Rows are ordered by deadline: finish #1 first when allocating labour. Overlapping bars mean
        jobs compete for the same period.
      </p>
      <div className="gantt-scroll">
        <div className="gantt-head">
          <div className="gantt-label-col">Priority / project</div>
          <div className="gantt-track-col">
            {ticks.map((t) => (
              <span
                key={t.toISOString()}
                className="gantt-tick"
                style={{ left: pct(dayIndex(rangeStart, t), 0, totalDays).left }}
              >
                {t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            ))}
            <div className="gantt-today-line" style={{ left: `${todayLeft}%` }} />
          </div>
        </div>
        {ranked.map((p) => {
          const projectStart = p.window?.start || null;
          const projectEnd = p.window?.end || null;
          const hasProjectBar = !!(projectStart && projectEnd);
          const visits = (p.siteVisits || []).filter((v) => v.scheduledAt);
          const projectLagging =
            p.projectStatus === 'LAGGING' ||
            (p.stages || []).some((s) => s.status === 'LAGGING');
          const deadlineLeft =
            projectEnd != null
              ? (dayIndex(rangeStart, projectEnd) / totalDays) * 100
              : null;
          return (
            <div
              key={p.id}
              className={`gantt-group${selectedId === p.id ? ' selected' : ''}${projectLagging ? ' lagging-group' : ''}${p.overlaps ? ' overlap-group' : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <div className="gantt-row">
                <div className="gantt-label-col">
                  <div className="gantt-priority-row">
                    {p.labourRank != null ? (
                      <span className="gantt-priority-badge" title="Finish earlier for labour">
                        #{p.labourRank}
                      </span>
                    ) : (
                      <span className="gantt-priority-badge muted-badge">—</span>
                    )}
                    <strong>
                      {p.code} {p.name}
                    </strong>
                  </div>
                  <span className="muted">
                    {p.status}
                    {projectEnd
                      ? ` · due ${projectEnd.toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })}`
                      : ' · no deadline'}
                    {projectLagging ? ' · behind plan' : ''}
                  </span>
                  {p.overlaps && (
                    <span className="gantt-overlap-chip">
                      Overlaps {p.overlapsWith.slice(0, 3).join(', ')}
                      {p.overlapsWith.length > 3 ? '…' : ''}
                    </span>
                  )}
                  {(p.people || []).length > 0 && (
                    <span className="gantt-people">
                      {(p.people || [])
                        .slice(0, 4)
                        .map((person) => person.fullName)
                        .join(', ')}
                      {(p.people || []).length > 4
                        ? ` +${(p.people || []).length - 4}`
                        : ''}
                    </span>
                  )}
                </div>
                <div className="gantt-track-col">
                  <div className="gantt-today-line" style={{ left: `${todayLeft}%` }} />
                  {hasProjectBar && (
                    <div
                      className={`gantt-bar project${projectLagging ? ' lagging' : ''}${p.overlaps ? ' overlap' : ''}`}
                      style={pct(
                        dayIndex(rangeStart, projectStart!),
                        Math.max(1, dayIndex(projectStart!, projectEnd!) + 1),
                        totalDays,
                      )}
                      title={`${p.code} · ${projectStart!.toLocaleDateString()} to ${projectEnd!.toLocaleDateString()}${p.overlaps ? ' · overlaps other jobs' : ''}`}
                    />
                  )}
                  {deadlineLeft != null && (
                    <div
                      className="gantt-deadline"
                      style={{ left: `${deadlineLeft}%` }}
                      title={`Deadline ${projectEnd!.toLocaleDateString()}`}
                    >
                      <span className="gantt-deadline-mark" />
                      <span className="gantt-deadline-label">Due</span>
                    </div>
                  )}
                  {visits.map((v) => {
                    const when = new Date(v.scheduledAt!);
                    const left = dayIndex(rangeStart, when);
                    return (
                      <div
                        key={v.id}
                        className={`gantt-marker visit status-${v.status.toLowerCase()}`}
                        style={{ left: `${(left / totalDays) * 100}%` }}
                        title={`${v.code} · ${when.toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })} · ${v.status}`}
                      >
                        <span className="gantt-marker-dot" />
                        <span className="gantt-marker-label">
                          {v.code}{' '}
                          {when.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {(p.stages || [])
                .filter((s) => s.plannedStartAt && s.plannedEndAt)
                .map((s) => {
                  const sStart = new Date(s.plannedStartAt!);
                  const sEnd = new Date(s.plannedEndAt!);
                  const daysBehind = s.daysBehind || 0;
                  return (
                    <div key={s.id} className="gantt-row stage-row">
                      <div className="gantt-label-col">
                        <span>{s.name}</span>
                        {s.status === 'LAGGING' && (
                          <span className="gantt-lag-chip">{daysBehind || '?'}d behind</span>
                        )}
                      </div>
                      <div className="gantt-track-col">
                        <div className="gantt-today-line" style={{ left: `${todayLeft}%` }} />
                        <div
                          className={`gantt-bar stage${s.status === 'LAGGING' ? ' lagging' : ''}${s.status === 'DONE' ? ' done' : ''}`}
                          style={pct(
                            dayIndex(rangeStart, sStart),
                            Math.max(1, dayIndex(sStart, sEnd) + 1),
                            totalDays,
                          )}
                          title={
                            s.status === 'LAGGING'
                              ? `${s.name} · ${daysBehind}d behind plan`
                              : s.name
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              {!hasProjectBar &&
                !visits.length &&
                !(p.stages || []).some((s) => s.plannedStartAt && s.plannedEndAt) && (
                  <div className="gantt-row">
                    <div className="gantt-label-col muted">No dates planned yet</div>
                    <div className="gantt-track-col">
                      <div className="gantt-today-line" style={{ left: `${todayLeft}%` }} />
                    </div>
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
