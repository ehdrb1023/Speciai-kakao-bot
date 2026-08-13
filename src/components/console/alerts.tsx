'use client';

import { createContext, useContext } from 'react';

/**
 * 새 카톡을 셸에 알리는 통로.
 *
 * 알림을 받은 카톡 뷰 안에서 그리지 않는 이유: 안 보는 탭은 `.view{display:none}` 으로
 * 감춰지고, display:none 안에 있는 position:fixed 요소는 아예 그려지지 않는다. 다른 탭을
 * 보는 중에 뜨는 것이 알림의 존재 이유이므로, 감지는 뷰가 하고 표시는 셸이 한다.
 *
 * 셸 밖에서 뷰를 단독으로 쓰는 경우(preview)는 아무 데도 안 보내고 조용히 버린다.
 */
export interface KakaoAlerts {
  /** 미처리 방 수. 탭 배지와 브라우저 탭 제목이 이 값을 쓴다. */
  setUnhandled: (count: number) => void;
  /** 새 카톡이 왔다. 토스트로 한 번 알린다. */
  notify: (alert: { title: string; body: string }) => void;
}

const NOOP: KakaoAlerts = { setUnhandled: () => {}, notify: () => {} };

const KakaoAlertsContext = createContext<KakaoAlerts>(NOOP);

export const KakaoAlertsProvider = KakaoAlertsContext.Provider;

export function useKakaoAlerts(): KakaoAlerts {
  return useContext(KakaoAlertsContext);
}
