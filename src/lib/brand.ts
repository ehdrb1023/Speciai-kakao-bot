// 회사 브랜딩 — 배포 환경변수로 갈아끼운다.
// 서버·클라이언트 양쪽에서 읽으므로 전부 NEXT_PUBLIC_* 을 쓴다.
// 새 하드코딩을 넣지 말 것 — 다른 회사에 그대로 세울 수 있는 형태를 유지한다.

export const BRAND = {
  /** 회사명. 화면 상단·문서 title 에 들어간다. */
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? '카톡 통합함',
  /** 상단 좌측 원형 마크에 들어갈 1글자. */
  mark: process.env.NEXT_PUBLIC_BRAND_MARK ?? '톡',
  /** 대화창에서 우리측 발화에 붙는 칩 라벨. 상대측 발화는 거래처명이 붙는다. */
  staffLabel: process.env.NEXT_PUBLIC_STAFF_LABEL ?? '우리',
  /** 로그인 화면 부제. */
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? '거래처 카톡 통합 콘솔',
} as const;
