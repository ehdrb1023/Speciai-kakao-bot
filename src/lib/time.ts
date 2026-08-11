// 시각 표시 — 타임존을 고정한다.
//
// 고정하지 않으면 서버(Vercel = UTC)와 브라우저(KST)가 같은 시각을 9시간 다르게 렌더해
// SSR HTML 과 하이드레이션 결과가 어긋난다. React #418(텍스트 불일치)이 그것이고,
// 하이드레이션이 깨지면 그 트리의 이벤트 핸들러·useEffect 가 정상 등록되지 않는다.
//
// 사용자 로컬 타임존을 쓰려면 시각 표시를 마운트 이후로 미뤄야 하고, 그러면 목록이 한 번
// 깜빡인다. 국내 사무실 전용 도구라 표시 기준을 서울로 못 박는 쪽이 낫다.
export const DISPLAY_TZ = 'Asia/Seoul';

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hm = new Intl.DateTimeFormat('ko-KR', {
  timeZone: DISPLAY_TZ,
  hour: '2-digit',
  minute: '2-digit',
});

const monthDayHm = new Intl.DateTimeFormat('ko-KR', {
  timeZone: DISPLAY_TZ,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const ymdHm = new Intl.DateTimeFormat('ko-KR', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const ymdOnly = new Intl.DateTimeFormat('ko-KR', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** 서울 기준 날짜 키 "2026-08-11". 날짜 구분선 묶기와 "오늘인가" 판정에 쓴다. */
export function seoulDateKey(value: string | Date): string {
  return ymd.format(new Date(value));
}

/** "2026년 8월 11일" — 대화 날짜 구분선. */
export function seoulDayLabel(value: string | Date): string {
  const [y, m, d] = seoulDateKey(value).split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

/** "오후 01:21" */
export function seoulClock(value: string | Date): string {
  return hm.format(new Date(value));
}

/** "8. 11. 오후 01:21" */
export function seoulMonthDayTime(value: string | Date): string {
  return monthDayHm.format(new Date(value));
}

/** "2026. 8. 11. 오후 01:21" */
export function seoulFull(value: string | Date): string {
  return ymdHm.format(new Date(value));
}

/** "2026. 8. 11." */
export function seoulDate(value: string | Date): string {
  return ymdOnly.format(new Date(value));
}
