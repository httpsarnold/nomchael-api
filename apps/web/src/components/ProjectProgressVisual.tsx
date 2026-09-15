'use client';

import { useMemo } from 'react';
import Link from 'next/link';

export type ProgressStage = {
  id: string;
  name: string;
  sortOrder?: number;
  isCompleted?: boolean;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  completedAt?: string | null;
  actualStartAt?: string | null;
};

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function dayLabel(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function stageScheduleStatus(stage: ProgressStage, now = new Date()) {
  if (stage.isCompleted) {
    let slipped = 0;
    if (stage.plannedEndAt && stage.completedAt) {
      slipped = Math.max(0, daysBetween(new Date(stage.completedAt), new Date(stage.plannedEndAt)));
    }
    return {
      key: 'DONE' as const,
      label: slipped > 0 ? `Done · finished ${slipped}d late` : 'Done',
      daysBehind: slipped,
    };
  }
  if (stage.plannedEndAt) {
    const end = new Date(stage.plannedEndAt);
    const behind = Math.max(0, daysBetween(now, end));
    if (behind > 0) {
      return { key: 'LAPSED' as const, label: `${behind}d behind plan`, daysBehind: behind };
    }
    if (stage.plannedStartAt && now >= new Date(stage.plannedStartAt)) {
      return { key: 'ACTIVE' as const, label: 'In progress', daysBehind: 0 };
    }
    return { key: 'ON_TRACK' as const, label: 'On track', daysBehind: 0 };
  }
  return { key: 'UNPLANNED' as const, label: 'No plan dates', daysBehind: 0 };
}

export function ProjectProgressVisual({
  projectCode,
  completionPercent,
  plannedStartAt,
  plannedEndAt,
  stages,
  compact,
}: {
  projectCode?: string;
  completionPercent?: number;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  stages: ProgressStage[];
  compact?: boolean;
}) {
  const now = useMemo(() => new Date(), []);
  const analyzed = useMemo(() => {
    const rows = (stages || []).map((s) => ({
      ...s,
      schedule: stageScheduleStatus(s, now),
    }));
    const done = rows.filter((s) => s.schedule.key === 'DONE').length;
    const lapsed = rows.filter((s) => s.schedule.key === 'LAPSED');
    const maxBehind = lapsed.reduce((m, s) => Math.max(m, s.schedule.daysBehind), 0);
    let projectBehind = 0;
    if (plannedEndAt) {
      projectBehind = Math.max(0, daysBetween(now, new Date(plannedEndAt)));
    } else {
      projectBehind = maxBehind;
    }
    const pct =
      completionPercent != null
        ? completionPercent
        : rows.length
          ? Math.round((done / rows.length) * 100)
          : 0;
    return { rows, done, lapsed, maxBehind, projectBehind, pct };
  }, [stages, completionPercent, plannedEndAt, now]);

  const timeline = useMemo(() => {
    const dates: Date[] = [];
    if (plannedStartAt) dates.push(new Date(plannedStartAt));
    if (plannedEndAt) dates.push(new Date(plannedEndAt));
    for (const s of stages || []) {
      if (s.plannedStartAt) dates.push(new Date(s.plannedStartAt));
      if (s.plannedEndAt) dates.push(new Date(s.plannedEndAt));
    }
    dates.push(now);
    if (!dates.length) return null;
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const span = Math.max(1, daysBetween(max, min) || 1);
    const pctOf = (d: Date) => Math.max(0, Math.min(100, (daysBetween(d, min) / span) * 100));
    const startPct = pctOf(new Date(plannedStartAt || min));
    const endPct = pctOf(new Date(plannedEndAt || max));
    return {
      min,
      max,
      nowPct: pctOf(now),
      projectLeft: Math.min(startPct, endPct),
      projectWidth: Math.max(1.5, Math.abs(endPct - startPct)),
    };
  }, [stages, plannedStartAt, plannedEndAt, now]);

  return (
    <div className={`progress-visual${compact ? ' compact' : ''}`}>
      <div className="progress-visual-head">
        <div>
          <h3 style={{ margin: 0 }}>
            {projectCode ? `${projectCode} · ` : ''}Progress & schedule
          </h3>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            See how far the job has moved and which stages have lapsed behind plan.
          </p>
        </div>
        <div className="progress-visual-kpis">
          <div>
            <div className="label">Complete</div>
            <div className="value">{analyzed.pct}%</div>
          </div>
          <div>
            <div className="label">Stages done</div>
            <div className="value">
              {analyzed.done}/{analyzed.rows.length || 0}
            </div>
          </div>
          <div>
            <div className="label">Lapsed</div>
            <div className={`value${analyzed.lapsed.length ? ' danger' : ''}`}>
              {analyzed.lapsed.length}
            </div>
          </div>
          <div>
            <div className="label">Behind</div>
            <div className={`value${analyzed.projectBehind ? ' danger' : ''}`}>
              {analyzed.projectBehind ? `${analyzed.projectBehind}d` : '0d'}
            </div>
          </div>
        </div>
      </div>

      <div className="progress-visual-bar-wrap">
        <div className="progress-visual-bar">
          <div className="progress-visual-bar-fill" style={{ width: `${analyzed.pct}%` }} />
        </div>
        <div className="progress-visual-bar-meta">
          <span>{analyzed.pct}% complete</span>
          {analyzed.lapsed.length > 0 ? (
            <span className="danger-text">
              {analyzed.lapsed.length} stage
              {analyzed.lapsed.length === 1 ? '' : 's'} lapsed
              {analyzed.maxBehind ? ` · worst ${analyzed.maxBehind}d behind` : ''}
            </span>
          ) : (
            <span className="ok-text">No stages behind plan</span>
          )}
        </div>
      </div>

      {timeline && (
        <div className="progress-visual-rail">
          <div className="progress-visual-rail-track">
            {(plannedStartAt || plannedEndAt) && (
              <div
                className="progress-visual-rail-project"
                style={{
                  left: `${timeline.projectLeft}%`,
                  width: `${timeline.projectWidth}%`,
                }}
                title="Project planned window"
              />
            )}
            <div
              className="progress-visual-rail-today"
              style={{ left: `${timeline.nowPct}%` }}
              title="Today"
            >
              <span>Today</span>
            </div>
          </div>
          <div className="progress-visual-rail-labels">
            <span>{dayLabel(plannedStartAt || timeline.min.toISOString())}</span>
            <span>{dayLabel(plannedEndAt || timeline.max.toISOString())}</span>
          </div>
        </div>
      )}

      <div className="progress-stage-list">
        {analyzed.rows.map((s, idx) => (
          <div key={s.id} className={`progress-stage-row status-${s.schedule.key.toLowerCase()}`}>
            <div className="progress-stage-index">{idx + 1}</div>
            <div className="progress-stage-body">
              <div className="progress-stage-title">
                <strong>{s.name}</strong>
                <span className={`badge ${s.schedule.key === 'LAPSED' ? 'danger' : s.schedule.key === 'DONE' ? 'ok' : ''}`}>
                  {s.schedule.label}
                </span>
              </div>
              <div className="progress-stage-dates muted">
                Plan {dayLabel(s.plannedStartAt)} to {dayLabel(s.plannedEndAt)}
                {s.completedAt ? ` · Done ${dayLabel(s.completedAt)}` : ''}
              </div>
              <div className="progress-stage-meter">
                <div
                  className={`progress-stage-meter-fill ${s.schedule.key.toLowerCase()}`}
                  style={{
                    width:
                      s.schedule.key === 'DONE'
                        ? '100%'
                        : s.schedule.key === 'LAPSED'
                          ? '100%'
                          : s.schedule.key === 'ACTIVE'
                            ? '55%'
                            : s.schedule.key === 'ON_TRACK'
                              ? '20%'
                              : '8%',
                  }}
                />
              </div>
            </div>
          </div>
        ))}
        {!analyzed.rows.length && (
          <p className="muted" style={{ margin: 0 }}>
            No stages on this project yet.
          </p>
        )}
      </div>

      {!compact && (
        <p className="muted" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
          Set or adjust planned dates on{' '}
          <Link href="/timeline">Project timeline</Link> so lapse against the programme is clear.
        </p>
      )}
    </div>
  );
}
