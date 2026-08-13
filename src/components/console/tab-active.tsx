'use client';

import { createContext, useContext } from 'react';

/**
 * 이 뷰가 지금 보고 있는 탭인지.
 *
 * 콘솔은 탭을 오갈 때 화면을 **언마운트하지 않는다**(ConsoleShell 주석 참고). 한 번 연 탭은
 * 계속 살아 있고 CSS 로만 숨는다 — 그래야 돌아왔을 때 방 목록·대화·쓰다 만 초안이 그대로다.
 *
 * 대신 살아 있는 뷰가 전부 폴링을 돌면 탭 수만큼 요청이 늘어난다. 그래서 각 뷰는 이 값이
 * false 인 동안 네트워크를 쓰지 않는다. 보이는 탭 하나만 폴링하므로 요청 수는 예전(언마운트
 * 하던 시절)과 같고, 얻은 것은 상태 유지뿐이다.
 *
 * 셸 밖에서 뷰를 단독으로 쓰는 경우(preview)는 항상 보이는 것으로 본다.
 */
const TabActiveContext = createContext(true);

export const TabActiveProvider = TabActiveContext.Provider;

export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}
