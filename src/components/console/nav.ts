'use client';

// 콘솔 SPA 탭 간 이동 헬퍼.
// slots(서버 주입) 구조라 뷰 간 setView 를 직접 공유할 수 없어, 전역 커스텀 이벤트로 탭을 전환한다.
// 구 프론트(window.location.href='/injury' 등)로의 이탈을 대체한다.

import type { ViewKey } from './ConsoleShell';

export const CV2_NAV_EVENT = 'cv2:nav';

export interface Cv2NavDetail {
  view: ViewKey;
  // 선택: 대상 뷰에 넘길 파라미터(예: 사건 id). 뷰가 window 이벤트로 수신.
  params?: Record<string, string>;
}

// 콘솔 탭 전환. 어느 뷰에서든 호출 → shell 이 view 를 바꾼다.
export function navigateConsole(view: ViewKey, params?: Record<string, string>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Cv2NavDetail>(CV2_NAV_EVENT, { detail: { view, params } }));
}
