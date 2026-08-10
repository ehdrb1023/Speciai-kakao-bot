'use client';

import type { ReactNode } from 'react';
import { IconClose } from './Icons';

/* 화면설계서 공통 UI 프리미티브 — console.css 유틸 클래스를 감싸는 얇은 래퍼.
   모든 화면이 동일 어휘로 상태칩·통계·배너·표·마법사 단계를 구성한다. */

// ===== 상태 칩 (mc) =====
export type ChipTone = 'blue' | 'green' | 'orange' | 'red' | 'neutral';
const CHIP_CLS: Record<ChipTone, string> = {
  blue: 'b',
  green: 'g',
  orange: 'o',
  red: 'r',
  neutral: 'n',
};

export function StatusChip({
  tone = 'neutral',
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return <span className={`mc ${CHIP_CLS[tone]}`}>{children}</span>;
}

// ===== 통계 카드 (dstat) =====
export type StatTone = 'orange' | 'red' | 'blue' | 'plain';
export function StatCard({
  label,
  value,
  tone = 'plain',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
}) {
  const t = tone === 'plain' ? '' : ` ${tone === 'orange' ? 'o' : tone === 'red' ? 'r' : 'b'}`;
  return (
    <div className={`dstat${t}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

// ===== 배너 (banner) =====
export type BannerTone = 'info' | 'dark' | 'warn';
export function Banner({
  tone = 'info',
  children,
}: {
  tone?: BannerTone;
  children: ReactNode;
}) {
  const t = tone === 'info' ? '' : ` ${tone}`;
  return <div className={`banner${t}`}>{children}</div>;
}

// ===== 섹션 카드 (mcard 헤더+본문) =====
export function SectionCard({
  title,
  sub,
  actions,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dash-section">
      {(title || actions) && (
        <div className="dash-section-head">
          <div>
            {title && <div className="dash-section-title">{title}</div>}
            {sub && <div className="dash-section-sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ===== 데이터 표 (mtbl) =====
export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  num?: boolean;
}
export function DataTable<T>({
  columns,
  rows,
  keyOf,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, i: number) => string;
}) {
  return (
    <table className="mtbl">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} className={c.num ? 'num' : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={keyOf(row, ri)}>
            {columns.map((c, ci) => (
              <td key={ci} className={c.num ? 'num' : undefined}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ===== 마법사 단계 + 진도율 링 (steps / ring) =====
export interface WizardStep {
  label: string;
  state: 'done' | 'current' | 'todo';
}
export function WizardSteps({
  steps,
  percent,
  onStep,
}: {
  steps: WizardStep[];
  percent?: number;
  onStep?: (index: number) => void;
}) {
  return (
    <div>
      <div className="steps">
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`st${s.state === 'current' ? ' on' : s.state === 'done' ? ' done' : ''}`}
            onClick={onStep ? () => onStep(i) : undefined}
          >
            <span className="n">{s.state === 'done' ? '✓' : i + 1}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      {typeof percent === 'number' && (
        <div className="ring" style={{ ['--p' as string]: `${percent}%` }}>
          <i>{percent}%</i>
        </div>
      )}
    </div>
  );
}

// ===== 모달 (app.css .modal-bg / .modal 재사용) =====
export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        style={width ? { maxWidth: width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || sub) && (
          <div className="modal-head">
            <div>
              {title && <div className="modal-title">{title}</div>}
              {sub && <div className="modal-sub">{sub}</div>}
            </div>
            <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
              <IconClose />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
