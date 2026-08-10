'use client';

// 공통 빈 상태 — 아이콘·제목·설명·(선택)액션. 각 뷰가 데이터 없을 때 밋밋한 한 줄 대신
// 시각적 무게와 다음 행동(CTA)을 주어 사용자 친화적으로 안내한다.

import { Ic } from './IconDefs';
import type { ReactNode } from 'react';

export function EmptyState({
  icon = 'i-doc',
  title,
  desc,
  action,
  compact = false,
}: {
  icon?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`emptyst${compact ? ' compact' : ''}`}>
      <div className="emptyst-ic"><Ic id={icon} w={26} /></div>
      <div className="emptyst-title">{title}</div>
      {desc ? <div className="emptyst-desc">{desc}</div> : null}
      {action ? <div className="emptyst-action">{action}</div> : null}
    </div>
  );
}
