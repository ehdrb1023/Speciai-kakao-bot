// 미리보기 전용 목업 데이터. DB·Supabase 없이 UI 를 확인하기 위한 것이며 제품 코드가 참조하지 않는다.
//
// 시각은 "지금"을 기준으로 상대 계산한다 — 고정 날짜를 박아두면 며칠 뒤 미리보기에서
// 전부 옛날 대화로 보여 목록 정렬·"오늘" 표시가 어떻게 나오는지 확인할 수 없다.

import type { InboxRoom, InboxMessage } from '@/components/console/views/InboxView';
import type { PartnerRow } from '@/server/actions/partners';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const PREVIEW_ROOMS: InboxRoom[] = [
  {
    id: 'r1',
    roomName: '[삼성전자] 3분기 발주 건',
    partnerId: 'p1',
    partnerName: '삼성전자',
    color: 'blue',
    pinned: true,
    handled: false,
    lastMessageAt: ago(12 * MIN),
    preview: '내일까지 수정된 견적서 보내주실 수 있을까요?',
    messageCount: 6,
  },
  {
    id: 'r2',
    roomName: '[LG화학] 납기 협의',
    partnerId: 'p2',
    partnerName: 'LG화학',
    color: 'green',
    pinned: false,
    handled: false,
    lastMessageAt: ago(3 * HOUR),
    preview: '[사진] 도면_v3.jpg',
    messageCount: 4,
  },
  {
    id: 'r3',
    roomName: '[삼성전자] 반도체 사업부 정기',
    partnerId: 'p1',
    partnerName: '삼성전자',
    color: 'blue',
    pinned: false,
    handled: true,
    lastMessageAt: ago(2 * DAY),
    preview: '확인했습니다. 감사합니다.',
    messageCount: 3,
  },
  {
    id: 'r4',
    roomName: '[대성건설] 자재 문의',
    partnerId: 'p3',
    partnerName: '대성건설',
    color: null,
    pinned: false,
    handled: true,
    lastMessageAt: ago(5 * DAY),
    preview: '다음 주에 다시 연락드릴게요',
    messageCount: 2,
  },
];

export const PREVIEW_MESSAGES: Record<string, InboxMessage[]> = {
  r1: [
    {
      id: 'm1',
      speaker: '박부장',
      body: '안녕하세요. 3분기 발주 건 관련해서 문의드립니다.',
      side: 'partner',
      sentAt: ago(DAY + 2 * HOUR),
      attachment: null,
    },
    {
      id: 'm2',
      speaker: '박부장',
      body: '지난번 보내주신 견적서에서 단가가 조금 조정될 것 같은데 확인 가능하실까요?',
      side: 'partner',
      sentAt: ago(DAY + 2 * HOUR - MIN),
      attachment: null,
    },
    {
      id: 'm3',
      speaker: '신동규',
      body: '안녕하세요 부장님. 확인해 보겠습니다. 어느 품목인지 알려주시면 빠르게 보겠습니다.',
      side: 'us',
      sentAt: ago(DAY + HOUR),
      attachment: null,
    },
    {
      id: 'm4',
      speaker: '박부장',
      body: 'A-2 라인 부품 전체입니다. 수량은 그대로고 단가만 재산정 부탁드려요.',
      side: 'partner',
      sentAt: ago(DAY),
      attachment: null,
    },
    {
      id: 'm5',
      speaker: '신동규',
      body: '네 확인했습니다. 재산정해서 회신드리겠습니다.',
      side: 'us',
      sentAt: ago(20 * HOUR),
      attachment: null,
    },
    {
      id: 'm6',
      speaker: '박부장',
      body: '내일까지 수정된 견적서 보내주실 수 있을까요?',
      side: 'partner',
      sentAt: ago(12 * MIN),
      attachment: null,
    },
  ],
  r2: [
    {
      id: 'm7',
      speaker: '김과장',
      body: '납기 일정 관련해서 도면 다시 보내드립니다.',
      side: 'partner',
      sentAt: ago(4 * HOUR),
      attachment: null,
    },
    {
      id: 'm8',
      speaker: '김과장',
      // 미리보기에서는 서명 URL 이 없어 파일명만 뜬다 — 실제 화면에서는 여기에 사진이 렌더된다.
      body: '[사진] 도면_v3.jpg',
      side: 'partner',
      sentAt: ago(3 * HOUR),
      attachment: { path: 'preview/도면_v3.jpg', type: 'image', name: '도면_v3.jpg' },
    },
  ],
  r3: [
    {
      id: 'm9',
      speaker: '이차장',
      body: '정기 미팅 자료 공유드립니다.',
      side: 'partner',
      sentAt: ago(2 * DAY + HOUR),
      attachment: null,
    },
    {
      id: 'm10',
      speaker: '신동규',
      body: '확인했습니다. 감사합니다.',
      side: 'us',
      sentAt: ago(2 * DAY),
      attachment: null,
    },
  ],
  r4: [
    {
      id: 'm11',
      speaker: '최소장',
      body: '자재 단가표 있으실까요?',
      side: 'partner',
      sentAt: ago(5 * DAY + HOUR),
      attachment: null,
    },
    {
      id: 'm12',
      speaker: '최소장',
      body: '다음 주에 다시 연락드릴게요',
      side: 'partner',
      sentAt: ago(5 * DAY),
      attachment: null,
    },
  ],
};

export const PREVIEW_PARTNERS: PartnerRow[] = [
  {
    id: 'p1',
    name: '삼성전자',
    color: 'blue',
    memo: null,
    roomCount: 2,
    rules: [
      { id: 'ru1', partnerId: 'p1', kind: 'prefix', pattern: '[삼성전자]', priority: 0, enabled: true },
    ],
  },
  {
    id: 'p2',
    name: 'LG화학',
    color: 'green',
    memo: null,
    roomCount: 1,
    rules: [
      { id: 'ru2', partnerId: 'p2', kind: 'prefix', pattern: '[LG화학]', priority: 0, enabled: true },
    ],
  },
  {
    id: 'p3',
    name: '대성건설',
    color: null,
    memo: null,
    roomCount: 1,
    // 규칙이 0개인 거래처 — 경고 문구가 어떻게 뜨는지 확인하기 위한 케이스.
    rules: [],
  },
];

export const PREVIEW_UNMATCHED = [
  { id: 'u1', roomName: '[현대모비스] 신규 견적', hitCount: 7, lastSeenAt: ago(40 * MIN) },
  { id: 'u2', roomName: '[포스코] 자재 공급', hitCount: 2, lastSeenAt: ago(6 * HOUR) },
];

export const PREVIEW_MEMBERS = [
  {
    userId: 'u-1',
    email: 'speciai250331@gmail.com',
    displayName: '신동규',
    role: 'owner' as const,
    joinedAt: ago(30 * DAY),
    isSelf: true,
  },
  {
    userId: 'u-2',
    email: 'staff@example.com',
    displayName: '김대리',
    role: 'admin' as const,
    joinedAt: ago(10 * DAY),
    isSelf: false,
  },
];

export const PREVIEW_STAFF_ALIASES = ['신동규', '김대리'];
