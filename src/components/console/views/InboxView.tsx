'use client';

// 받은 카톡 — 좌(방 목록) · 중(대화) · 우(방 정보) 3분할. 카톡을 닮은 말풍선 화면.
// 데이터 배선(폴링·발신 큐·방 상태 토글)은 그대로고, 겉모습만 토스풍 디자인이다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigateConsole } from '../nav';
import { useTabActive } from '../tab-active';
import { useKakaoAlerts } from '../alerts';
import { seoulClock, seoulDateKey, seoulDayLabel, seoulMonthDayTime } from '@/lib/time';

export interface InboxRoom {
  id: string;
  roomName: string;
  partnerId: string | null;
  partnerName: string | null;
  color: string | null;
  pinned: boolean;
  handled: boolean;
  lastMessageAt: string | null;
  preview: string;
  messageCount: number;
}

export interface InboxMessage {
  id: string;
  speaker: string;
  body: string;
  side: 'us' | 'partner';
  sentAt: string;
  attachment: { path: string; type: string; name: string; url?: string } | null;
}

/**
 * 아직 카톡방에 안 나갔거나 실패한 발신 건.
 *
 * 성공한 것은 여기 없다 — 서버가 kakao_messages 로 옮겨 담아 일반 메시지로 내려준다.
 * 그래서 이 목록은 "대기 중이거나 잘못된 것" 만 남고, 화면에서도 그렇게 보여야 한다.
 */
export interface InboxOutbound {
  id: string;
  roomId: string;
  body: string;
  authorName: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface InboxViewData {
  rooms: InboxRoom[];
  messagesByRoom: Record<string, InboxMessage[]>;
  outboundByRoom: Record<string, InboxOutbound[]>;
  staffLabel: string;
  /** viewer 는 열람 전용이라 입력창 대신 안내문을 본다. */
  canSend: boolean;
  /** 어느 거래처에도 연결되지 않아 본문을 저장하지 않은 방 수. */
  unmatchedCount: number;
}

type Filter = 'all' | 'unhandled' | 'pinned';

/**
 * 이 화면을 보고 있는 동안의 방 목록 폴링 주기.
 *
 * 실측(2026-08-13, 최근 20건): 거래처가 카톡을 친 시각 → DB 저장까지 **1.6~3.7초**(평균 2.3).
 * 수집 구간은 이미 빠르다. 사람이 느끼는 지연은 거의 전부 이 주기에서 나온다.
 *
 * 예전에는 변화가 없으면 10 → 20 → 40 → 60초로 늦췄다(백오프). 조용한 방을 보고 있으면
 * 1분 만에 60초 주기가 되고, 2초 만에 DB 에 들어온 메시지가 화면에는 최대 1분 뒤에 떴다.
 * "많이 느리다" 는 말이 나온 지점이 정확히 여기다(2026-08-13 대표 지시로 백오프 제거).
 *
 * 백오프가 실제로 아끼던 구간은 "화면을 켜고 이 탭을 보고 있는 동안" 뿐인데, 그게 바로
 * 사람이 새 메시지를 기다리는 시간이다. 거기서 아낀 요청값보다 1분 늦게 뜨는 화면이 비싸다.
 * 아끼는 일은 다른 세 곳이 이미 한다 — 창이 안 보이면 정지, 다른 탭이면 60초(POLL_MAX_MS),
 * 열어둔 방에 변화가 없으면 대화 본문은 안 받는다.
 *
 * 이 아래로 내리려면 주기를 더 줄일 게 아니라 Supabase Realtime 으로 바꿔야 한다.
 * 남은 2초는 폰 구간이라 주기를 0 으로 해도 사라지지 않는다.
 */
const POLL_MS = 5_000;
// 다른 탭(거래처·연결 진단)을 보는 동안의 주기. 이때 받아오는 이유는 화면이 아니라 탭 배지와
// 새 카톡 알림 때문이다. 대화 본문은 받지 않는다.
const POLL_MAX_MS = 60_000;

const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'gray'] as const;
const COLOR_HEX: Record<string, string> = {
  blue: '#3182f6',
  green: '#00b894',
  amber: '#f59e0b',
  red: '#e5484d',
  purple: '#8b5cf6',
  gray: '#8b95a1',
};
const COLOR_LABELS: Record<string, string> = {
  blue: '파랑',
  green: '초록',
  amber: '주황',
  red: '빨강',
  purple: '보라',
  gray: '회색',
};

export function InboxView({ data }: { data: InboxViewData }) {
  const [rooms, setRooms] = useState(data.rooms);
  const [activeId, setActiveId] = useState<string | null>(data.rooms[0]?.id ?? null);
  const [messages, setMessages] = useState<Record<string, InboxMessage[]>>(data.messagesByRoom);
  const [outbound, setOutbound] = useState<Record<string, InboxOutbound[]>>(data.outboundByRoom);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [colorOpen, setColorOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // 폴링 루프는 한 번만 만들고 최신 값을 ref 로 읽는다. rooms·activeId 를 의존성에 넣으면
  // 메시지가 올 때마다 타이머가 재생성돼 주기가 어긋난다.
  const roomsRef = useRef(rooms);
  const activeIdRef = useRef(activeId);
  // 낙관적 갱신(고정·처리완료·숨김)이 서버에 반영되기 전에 폴링 결과가 덮으면 방금 누른 게
  // 되돌아간다. 쓰기가 진행 중이면 그 주기는 건너뛴다.
  const writesInFlight = useRef(0);

  const active = rooms.find((r) => r.id === activeId) ?? null;
  const activeMessages = activeId ? messages[activeId] : undefined;
  const activeOutbound = (activeId ? outbound[activeId] : undefined) ?? [];

  // 다른 탭을 보는 동안에는 대화를 다시 받지 않는다. 다만 방 목록만은 60초에 한 번 계속
  // 받아온다 — 배지와 새 카톡 알림이 "받은 카톡 탭을 보고 있을 때만" 도는 것은 알림이 아니다.
  const tabActive = useTabActive();
  const alerts = useKakaoAlerts();
  // 폴링 루프는 한 번만 만들고 최신 값을 ref 로 읽는다(아래 주석 참고). 알림 통로도 같다.
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const tabActiveRef = useRef(tabActive);
  tabActiveRef.current = tabActive;
  /** 폴링 루프 안의 poll 을 밖에서 한 번 부르기 위한 통로. 탭으로 돌아온 순간에 쓴다. */
  const pollNowRef = useRef<(() => Promise<void>) | null>(null);

  // 대기 중인 발신이 있으면 폴링이 대화를 매 주기 다시 받아야 한다. 방 목록의 lastMessageAt
  // 만 보면 "보냈는지" 가 안 바뀌고, 사람은 그 상태를 기다리며 화면을 보고 있다.
  const pendingRef = useRef(false);
  pendingRef.current = activeOutbound.some((o) => o.status === 'pending' || o.status === 'sending');

  const visibleRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rooms.filter((r) => {
      if (filter === 'unhandled' && r.handled) return false;
      if (filter === 'pinned' && !r.pinned) return false;
      if (!q) return true;
      return (
        r.roomName.toLowerCase().includes(q) ||
        (r.partnerName ?? '').toLowerCase().includes(q) ||
        r.preview.toLowerCase().includes(q)
      );
    });
    // 고정된 방을 위로. 나머지는 서버가 이미 최근순으로 준다.
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [rooms, query, filter]);

  // 목록 구분선: 고정 → 오늘 → 이전. 카톡처럼 훑는 순서를 만들어준다.
  const groupedRooms = useMemo(() => {
    const today = seoulDateKey(new Date());
    const groups: { label: string; rooms: InboxRoom[] }[] = [];
    for (const room of visibleRooms) {
      const label = room.pinned ? '고정' : room.lastMessageAt && seoulDateKey(room.lastMessageAt) === today ? '오늘' : '이전';
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rooms.push(room);
      else groups.push({ label, rooms: [room] });
    }
    return groups;
  }, [visibleRooms]);

  const unhandledCount = rooms.filter((r) => !r.handled).length;

  // 상단 탭 배지와 브라우저 탭 제목이 쓰는 숫자. 서버가 준 값이 굳어 있으면 방을 처리완료로
  // 바꾸거나 새 카톡이 와도 새로고침 전까지 안 변한다.
  useEffect(() => {
    alerts.setUnhandled(unhandledCount);
  }, [unhandledCount, alerts]);

  // 방을 고르면 대화를 지연 로드한다. 초기 렌더에는 첫 방만 실려 있다.
  const openRoom = useCallback(
    async (roomId: string) => {
      setActiveId(roomId);
      setColorOpen(false);
      setSendError(null);
      if (messages[roomId]) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/kakao/thread?roomId=${encodeURIComponent(roomId)}`);
        const json = (await res.json()) as {
          messages?: InboxMessage[];
          outbound?: InboxOutbound[];
        };
        setMessages((prev) => ({ ...prev, [roomId]: json.messages ?? [] }));
        setOutbound((prev) => ({ ...prev, [roomId]: json.outbound ?? [] }));
      } catch {
        setMessages((prev) => ({ ...prev, [roomId]: [] }));
      } finally {
        setLoading(false);
      }
    },
    [messages],
  );

  /** 보낼 것을 큐에 적는다. 여기서 카톡으로 나가지 않는다 — 봇이 가져가야 나간다. */
  async function sendDraft() {
    const roomId = activeId;
    const text = draft.trim();
    if (!roomId || !text || sending) return;

    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/kakao/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, body: text }),
      });
      const json = (await res.json()) as { outbound?: InboxOutbound; error?: string };
      if (!res.ok || !json.outbound) {
        setSendError(json.error ?? '보내지 못했습니다');
        return;
      }
      setOutbound((prev) => ({ ...prev, [roomId]: [...(prev[roomId] ?? []), json.outbound!] }));
      setDraft('');
    } catch {
      setSendError('네트워크가 끊겼습니다');
    } finally {
      setSending(false);
    }
  }

  async function cancelOutbound(id: string) {
    const roomId = activeId;
    if (!roomId) return;
    try {
      const res = await fetch(`/api/kakao/send?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setSendError(json.error ?? '취소하지 못했습니다');
        return;
      }
      setOutbound((prev) => ({
        ...prev,
        [roomId]: (prev[roomId] ?? []).filter((o) => o.id !== id),
      }));
    } catch {
      setSendError('네트워크가 끊겼습니다');
    }
  }

  // 새 대화를 열면 맨 아래(최신)로. 카톡과 같은 읽기 시작점을 준다.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, activeMessages]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /**
   * 주기적으로 방 목록을 다시 받아온다. 봇이 메시지를 올려도 이 화면은 스스로 알 방법이 없어
   * 새로고침 전까지 옛 상태로 남아 있었다.
   *
   * 창이 보일 때만 돈다. 사무실에서 하루종일 열어두는 화면이라, 백그라운드 탭·잠긴 화면에서도
   * 계속 부르면 아무도 안 보는 응답을 밤새 만들어내게 된다.
   */
  useEffect(() => {
    let stopped = false;

    function nextDelay() {
      // 다른 탭을 보는 중이면 배지·알림을 위한 최소한만 — 가장 느린 주기로 목록만 확인한다.
      // 보고 있는 동안은 늦추지 않는다(POLL_MS 주석 참고).
      return tabActiveRef.current ? POLL_MS : POLL_MAX_MS;
    }

    /**
     * 새 카톡이 온 방을 찾아 알린다.
     *
     * 지금 열어놓고 보고 있는 방은 알리지 않는다 — 눈앞에 뜬 말풍선을 다시 알려주는 것은
     * 소음이고, 우리가 대시보드에서 보낸 메시지도 여기로 되돌아오기 때문이다(ack 시점에
     * 서버가 kakao_messages 에 남긴다). 그건 자기가 방금 친 글이라 알릴 것이 아니다.
     */
    function announceNew(before: InboxRoom[], next: InboxRoom[], background: boolean) {
      if (before.length === 0) return; // 첫 로드 직후엔 전부 "새 것" 이라 알릴 것이 없다
      const openId = activeIdRef.current;
      const fresh = next.filter((r) => {
        if (!background && r.id === openId) return false;
        const prev = before.find((b) => b.id === r.id);
        return prev ? r.messageCount > prev.messageCount : r.messageCount > 0;
      });
      if (fresh.length === 0) return;

      const head = fresh[0]!;
      const name = head.partnerName ?? head.roomName;
      alertsRef.current.notify({
        title: fresh.length > 1 ? `${name} 외 ${fresh.length - 1}곳` : name,
        body: head.preview || '새 메시지',
      });
    }

    async function poll() {
      if (stopped) return;
      // 창이 안 보이는 동안은 부르지 않는다.
      if (document.visibilityState !== 'visible') return;
      if (writesInFlight.current > 0) return;
      // 다른 탭을 보는 중이면 목록까지만 본다(배지·알림용). 대화 재조회는 아래에서 멈춘다.
      const background = !tabActiveRef.current;

      try {
        const res = await fetch('/api/kakao/rooms', { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { rooms?: InboxRoom[] };
        const next = json.rooms;
        if (!next || stopped) return;

        const before = roomsRef.current;
        setRooms(next);
        announceNew(before, next, background);

        if (background) return;

        // 열어둔 방에 새 메시지가 있을 때만 대화를 다시 받는다. 매 주기마다 전체 대화를
        // 받으면 방 하나에 300건씩 실려 와 폴링 비용이 목록의 수십 배가 된다.
        const openId = activeIdRef.current;
        if (!openId) return;
        const prevRoom = before.find((r) => r.id === openId);
        const nextRoom = next.find((r) => r.id === openId);
        if (!nextRoom) return;
        const changed = prevRoom?.lastMessageAt !== nextRoom.lastMessageAt;
        // 새 메시지가 없어도 발신 대기가 남아 있으면 받아온다 — 나갔는지를 사람이 기다리고 있다.
        if (!changed && !pendingRef.current) return;

        const threadRes = await fetch(`/api/kakao/thread?roomId=${encodeURIComponent(openId)}`);
        if (!threadRes.ok || stopped) return;
        const threadJson = (await threadRes.json()) as {
          messages?: InboxMessage[];
          outbound?: InboxOutbound[];
        };
        setMessages((prev) => ({ ...prev, [openId]: threadJson.messages ?? [] }));
        setOutbound((prev) => ({ ...prev, [openId]: threadJson.outbound ?? [] }));
      } catch {
        // 네트워크가 끊긴 것뿐이다. 다음 주기에 다시 시도한다.
      }
    }

    // 창으로 돌아오면 주기를 기다리지 않고 즉시 한 번 — 다른 일 하다 온 사이 쌓인 것을 바로 보여준다.
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      void poll();
    }

    pollNowRef.current = poll;

    let timer = window.setTimeout(function tick() {
      void poll().finally(() => {
        if (!stopped) timer = window.setTimeout(tick, nextDelay());
      });
    }, POLL_MS);

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      pollNowRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 이 탭으로 돌아온 순간 즉시 한 번 받아온다. 다른 탭을 보는 동안 폴링을 멈춰둔 만큼
  // 화면이 뒤처져 있고, 주기를 기다리게 하면 결국 "새로고침해야 뜨네" 와 같아진다.
  // 첫 mount 는 서버가 방금 준 값이라 건너뛴다.
  const wasTabActive = useRef(true);
  useEffect(() => {
    if (!tabActive) {
      wasTabActive.current = false;
      return;
    }
    if (wasTabActive.current) return;
    wasTabActive.current = true;
    void pollNowRef.current?.();
  }, [tabActive]);

  async function patchRoom(roomId: string, patch: { pinned?: boolean; handled?: boolean; color?: string | null }) {
    // 낙관적 갱신 — 토글 반응이 왕복 지연만큼 늦으면 두 번 누르게 된다.
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId
          ? {
              ...r,
              pinned: patch.pinned ?? r.pinned,
              handled: patch.handled ?? r.handled,
              color: patch.color !== undefined ? patch.color : r.color,
            }
          : r,
      ),
    );
    writesInFlight.current += 1;
    try {
      const res = await fetch('/api/kakao/room-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, ...patch }),
      });
      if (!res.ok) {
        // 실패하면 서버 상태를 모르는 채로 두지 않는다.
        window.location.reload();
      }
    } finally {
      writesInFlight.current -= 1;
    }
  }

  /**
   * 방을 목록에서 내린다(soft delete). 대화 기록은 지우지 않는다 —
   * "그때 뭐라고 했더라" 가 반드시 나오기 때문이다.
   *
   * 그 방에 새 메시지가 오면 다시 나타난다(서버 touchRoom 이 deleted_at 을 푼다).
   * 살아 있는 방을 실수로 내려도 대화를 놓치지 않게 하기 위한 것이다.
   */
  async function hideRoom(roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    const label = room.partnerName ? `${room.partnerName} · ${room.roomName}` : room.roomName;
    if (
      !window.confirm(
        `"${label}" 을 목록에서 내릴까요?\n\n` +
          '모아둔 대화는 지워지지 않습니다. 그 방에 새 메시지가 오면 다시 나타납니다.\n' +
          '수집 자체를 멈추려면 카톡방에서 #등록해제 를 치거나 거래처 탭에서 연결을 끊으세요.',
      )
    ) {
      return;
    }

    const remaining = rooms.filter((r) => r.id !== roomId);
    setRooms(remaining);
    if (activeId === roomId) setActiveId(remaining[0]?.id ?? null);

    writesInFlight.current += 1;
    try {
      const res = await fetch('/api/kakao/room-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) window.location.reload();
    } finally {
      writesInFlight.current -= 1;
    }
  }

  // 우측 참여자 목록 — 불러온 대화에서 발화자를 모은다(별도 저장 테이블이 없다).
  const participants = useMemo(() => {
    const seen = new Map<string, 'us' | 'partner'>();
    for (const m of activeMessages ?? []) {
      if (!seen.has(m.speaker)) seen.set(m.speaker, m.side);
    }
    return [...seen.entries()].map(([name, side]) => ({ name, side }));
  }, [activeMessages]);

  if (rooms.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <b>아직 수집된 카톡방이 없어요</b>
          <p>
            {data.unmatchedCount > 0
              ? `봇이 방 ${data.unmatchedCount}개를 봤지만 어느 거래처에도 연결되지 않았어요. 거래처 탭에서 회사명을 등록한 뒤, 그 방에서 #등록 회사명 을 치세요.`
              : '거래처 탭에서 회사명을 등록하고, 카톡방에서 #등록 회사명 을 한 번 치면 여기에 대화가 쌓입니다.'}
          </p>
          <button type="button" className="btn primary sm" onClick={() => navigateConsole('partners')}>
            거래처 등록하러 가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox">
      {/* ── 좌: 방 목록 ── */}
      <div className="roomcol">
        <div className="field">
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6.2" cy="6.2" r="4.2" stroke="#8b95a1" strokeWidth="1.5" />
            <path d="M9.4 9.4L12 12" stroke="#8b95a1" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="방 이름, 거래처 검색"
            aria-label="방 검색"
          />
        </div>
        <div className="filters">
          <button type="button" className="fchip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            전체 {rooms.length}
          </button>
          <button
            type="button"
            className="fchip"
            aria-pressed={filter === 'unhandled'}
            onClick={() => setFilter('unhandled')}
          >
            미처리 {unhandledCount}
          </button>
          <button type="button" className="fchip" aria-pressed={filter === 'pinned'} onClick={() => setFilter('pinned')}>
            고정 {rooms.filter((r) => r.pinned).length}
          </button>
        </div>

        <div className="rooms">
          {data.unmatchedCount > 0 ? (
            <button
              type="button"
              className="fchip"
              style={{ margin: '8px 6px 0', height: 'auto', padding: '8px 13px', whiteSpace: 'normal', textAlign: 'left' }}
              onClick={() => navigateConsole('link')}
            >
              연결 안 된 방 {data.unmatchedCount}개 — 진단하러 가기
            </button>
          ) : null}

          {visibleRooms.length === 0 ? (
            <div className="rgroup">조건에 맞는 방이 없어요.</div>
          ) : (
            groupedRooms.map((g, gi) => (
              <div key={`${g.label}-${gi}`}>
                <div className="rgroup">{g.label}</div>
                {g.rooms.map((room) => (
                  // 내리기 버튼을 안에 두어야 해서 div 다 — button 안에 button 은 넣을 수 없다.
                  <div
                    key={room.id}
                    role="button"
                    tabIndex={0}
                    className="room"
                    aria-current={room.id === activeId}
                    onClick={() => void openRoom(room.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openRoom(room.id);
                      }
                    }}
                  >
                    <span className="r1">
                      <span
                        className="cdot"
                        style={room.color ? { background: COLOR_HEX[room.color] ?? undefined } : undefined}
                      />
                      <span className="rname">{room.partnerName ?? room.roomName}</span>
                      <span className="rtime">{shortTime(room.lastMessageAt)}</span>
                    </span>
                    <span className="rlast">{room.preview || '내용 없음'}</span>
                    <span className="rmeta">
                      {!room.handled ? <span className="tag point">미처리</span> : <span className="tag green">처리완료</span>}
                      <span className="tag">{room.partnerName ?? '연결 안 됨'}</span>
                    </span>
                    <button
                      type="button"
                      className="rdel"
                      aria-label={`${room.roomName} 목록에서 내리기`}
                      title="목록에서 내리기"
                      onClick={(e) => {
                        e.stopPropagation();
                        void hideRoom(room.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 중: 대화 ── */}
      <div className="threadcol">
        {active ? (
          <>
            <div className="thead">
              <div>
                <div className="tt">{active.partnerName ?? active.roomName}</div>
                <div className="ts">
                  {active.roomName} · 메시지 {active.messageCount}건 · 마지막 {shortTime(active.lastMessageAt) || '없음'}
                </div>
              </div>
              <div className="acts">
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="방 색상"
                  title="방 색상"
                  onClick={() => setColorOpen((v) => !v)}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: active.color ? COLOR_HEX[active.color] : 'var(--g300)',
                      display: 'block',
                    }}
                  />
                </button>
                {colorOpen ? (
                  <div className="colorpop">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`copt${active.color === c ? ' on' : ''}`}
                        style={{ background: COLOR_HEX[c] }}
                        aria-label={COLOR_LABELS[c]}
                        title={COLOR_LABELS[c]}
                        onClick={() => {
                          setColorOpen(false);
                          void patchRoom(active.id, { color: c });
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="copt none"
                      aria-label="색 없음"
                      title="색 없음"
                      onClick={() => {
                        setColorOpen(false);
                        void patchRoom(active.id, { color: null });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={active.pinned ? '고정 해제' : '상단 고정'}
                  title={active.pinned ? '고정 해제' : '상단 고정'}
                  onClick={() => void patchRoom(active.id, { pinned: !active.pinned })}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 1.8l1.7 3.9 4.2.4-3.2 2.8 1 4.1L8 10.9l-3.7 2.1 1-4.1L2.1 6.1l4.2-.4L8 1.8z"
                      fill={active.pinned ? '#3182f6' : 'none'}
                      stroke={active.pinned ? '#3182f6' : '#8b95a1'}
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`btn sm${active.handled ? '' : ' primary'}`}
                  onClick={() => void patchRoom(active.id, { handled: !active.handled })}
                >
                  {active.handled ? '처리완료됨' : '처리완료로 표시'}
                </button>
              </div>
            </div>

            <div className="msgs" ref={chatRef}>
              {loading && !activeMessages ? <div className="sysline">대화를 불러오는 중…</div> : null}
              {renderMessages(activeMessages ?? [], data.staffLabel)}
              {renderOutbound(activeOutbound, (id) => void cancelOutbound(id))}
            </div>

            {sendError ? <div className="note bad" style={{ margin: '10px 24px 0' }}>{sendError}</div> : null}

            <div className="composer">
              {!data.canSend ? (
                <div className="guard">열람 권한이라 보낼 수 없어요. 답장은 카카오톡에서 직접 보내주세요.</div>
              ) : !active.partnerId ? (
                <div className="guard">거래처에 연결되지 않은 방이에요. 카톡방에서 #등록 을 먼저 해주세요.</div>
              ) : (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter 전송, Shift+Enter 줄바꿈 — 카톡과 같은 손버릇.
                      // 한글 조합 중(isComposing)에는 무시한다. 안 그러면 마지막 글자가 잘린 채 나간다.
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void sendDraft();
                      }
                    }}
                    placeholder={`${active.partnerName ?? active.roomName} 방으로 보낼 메시지를 쓰세요 (Enter 전송 · Shift+Enter 줄바꿈)`}
                    maxLength={2000}
                  />
                  <div className="crow">
                    <span className="tiny muted">보내기를 누르면 대기열에 쌓이고, 봇 단말이 순서대로 전송합니다.</span>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={sending || !draft.trim()}
                      onClick={() => void sendDraft()}
                    >
                      {sending ? '보내는 중…' : '보내기'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="msgs">
            <div className="sysline">왼쪽에서 방을 고르면 대화가 표시됩니다.</div>
          </div>
        )}
      </div>

      {/* ── 우: 방 정보 ── */}
      <aside className="panel sidecol" aria-label="방 정보">
        {active ? (
          <>
            <div className="sblock">
              <div className="sname">{active.partnerName ?? '연결 안 됨'}</div>
              <div className="ssub">{active.roomName}</div>
              <div className="mini" style={{ marginTop: 16 }}>
                <div>
                  <span>메시지</span>
                  <b>{active.messageCount}</b>
                </div>
                <div>
                  <span>참여자</span>
                  <b>{participants.length || '—'}</b>
                </div>
                <div>
                  <span>상태</span>
                  <b>{active.handled ? '완료' : '미처리'}</b>
                </div>
              </div>
            </div>

            <div className="sblock">
              <div className="sh">방 정보</div>
              <div className="kv">
                <span className="k">거래처</span>
                <span className={`v${active.partnerName ? '' : ' warn'}`}>{active.partnerName ?? '연결 안 됨'}</span>
              </div>
              <div className="kv">
                <span className="k">방 제목</span>
                <span className="v" title={active.roomName}>
                  {active.roomName}
                </span>
              </div>
              <div className="kv">
                <span className="k">마지막 수신</span>
                <span className="v">{fullTime(active.lastMessageAt)}</span>
              </div>
            </div>

            {activeOutbound.length > 0 ? (
              <div className="sblock">
                <div className="sh">보낼 메시지</div>
                {activeOutbound.map((o) => (
                  <div key={o.id} className={`qitem${o.status === 'failed' ? ' failed' : ''}`}>
                    <div className="qt">{o.body}</div>
                    <div className="qm">
                      <span>
                        {o.status === 'failed'
                          ? `보내지 못함 (${o.attempts}회 시도)`
                          : o.status === 'sending'
                            ? '보내는 중…'
                            : '대기 중'}
                      </span>
                      <button type="button" className="btn sm" onClick={() => void cancelOutbound(o.id)}>
                        {o.status === 'failed' ? '지우기' : '취소'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {participants.length > 0 ? (
              <div className="sblock">
                <div className="sh">참여자 {participants.length}명</div>
                {participants.map((p) => (
                  <div key={p.name} className="prow">
                    <span className="pf2">{p.name.charAt(0)}</span>
                    <span className="pn2">{p.name}</span>
                    <span className={`tag${p.side === 'us' ? ' point' : ''}`}>
                      {p.side === 'us' ? data.staffLabel : active.partnerName ?? '거래처'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="sblock">
              <div className="sh">이 방 관리</div>
              <div className="sacts">
                <button
                  type="button"
                  className={`btn${active.handled ? '' : ' primary'}`}
                  onClick={() => void patchRoom(active.id, { handled: !active.handled })}
                >
                  {active.handled ? '미처리로 되돌리기' : '처리완료로 표시'}
                </button>
                <button type="button" className="btn" onClick={() => void patchRoom(active.id, { pinned: !active.pinned })}>
                  {active.pinned ? '고정 해제' : '상단 고정'}
                </button>
                <button type="button" className="btn danger" onClick={() => void hideRoom(active.id)}>
                  목록에서 내리기
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="sblock">
            <div className="sh">방 정보</div>
            <div className="muted tiny">방을 고르면 정보가 표시됩니다.</div>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * 본문 없이 첨부만 온 메시지에 서버가 붙이는 자리표시 문구(`ingestBotMessage` 와 같은 규칙).
 * 화면에서 첨부를 이미 보여주므로 같은 말을 한 번 더 적지 않으려고 대조용으로 쓴다.
 */
function autoLabel(att: InboxMessage['attachment']): string | null {
  if (!att) return null;
  return att.type === 'file' ? `[파일] ${att.name}` : `[사진] ${att.name}`;
}

/** 날짜가 바뀌는 지점에 구분선을 넣고, 같은 사람의 연속 발화는 말풍선만 이어 붙인다(카톡과 같은 읽기 리듬). */
function renderMessages(messages: InboxMessage[], staffLabel: string) {
  if (messages.length === 0) {
    return <div className="sysline">아직 이 방에 저장된 대화가 없어요.</div>;
  }

  const out: React.ReactNode[] = [];
  let lastDay = '';
  let lastSpeaker = '';

  for (const m of messages) {
    const day = seoulDateKey(m.sentAt);
    if (day !== lastDay) {
      out.push(
        <div key={`d-${m.id}`} className="daysep">
          {seoulDayLabel(m.sentAt)}
        </div>,
      );
      lastDay = day;
      lastSpeaker = '';
    }

    const grouped = m.speaker === lastSpeaker;
    lastSpeaker = m.speaker;
    const us = m.side === 'us';

    out.push(
      <div key={m.id} className={`msg${us ? ' us' : ''}`}>
        {!us ? <span className={`pf${grouped ? ' ghost' : ''}`}>{grouped ? '' : m.speaker.charAt(0)}</span> : null}
        <div className="col">
          {!grouped ? (
            <div className="who" style={us ? { textAlign: 'right' } : undefined}>
              {us ? `${m.speaker} · ${staffLabel}` : m.speaker}
            </div>
          ) : null}
          <div className="line">
            <div className="bub">
              {m.attachment?.url ? (
                <>
                  {/* 사진은 그 자리에서 보여주고, 그 외 첨부(PDF·DOCX…)는 링크로 준다.
                      파일을 <img> 로 그리면 깨진 이미지 아이콘만 남아 "안 왔다" 로 읽힌다. */}
                  {m.attachment.type === 'image' ? (
                    <img src={m.attachment.url} alt={m.attachment.name} />
                  ) : (
                    <a
                      className="att-file"
                      href={m.attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      title={m.attachment.name}
                      style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }}
                    >
                      📎 {m.attachment.name}
                    </a>
                  )}
                  {/* 본문이 서버가 지어준 자리표시(“[파일] 이름”)면 링크와 같은 말이라 빼둔다. */}
                  {m.body && m.body !== autoLabel(m.attachment) ? <span>{m.body}</span> : null}
                </>
              ) : (
                m.body
              )}
            </div>
            <span className="at">{seoulClock(m.sentAt)}</span>
          </div>
        </div>
      </div>,
    );
  }

  return out;
}

/**
 * 아직 안 나간 발신 건을 대화 끝에 얹는다.
 *
 * 나간 것과 눈으로 구별돼야 한다. "보낸 줄 알았는데 안 갔다" 가 업무 카톡에서 제일 나쁘고,
 * 이 앱은 서버가 카톡에 직접 말할 수 없어 그 간격이 실제로 존재한다(봇 폰이 꺼져 있으면 안 나간다).
 */
function renderOutbound(rows: InboxOutbound[], onCancel: (id: string) => void) {
  if (rows.length === 0) return null;

  return rows.map((o) => {
    const failed = o.status === 'failed';
    return (
      <div key={o.id} className={`msg us ${failed ? 'failedmsg' : 'pending'}`}>
        <div className="col">
          <div className="line">
            <div className="bub">{o.body}</div>
            <span className="at">
              {failed ? `보내지 못함 (${o.attempts}회)` : o.status === 'sending' ? '보내는 중…' : '전송 대기'}
              <button type="button" className="cancel" onClick={() => onCancel(o.id)}>
                {failed ? '지우기' : '취소'}
              </button>
            </span>
          </div>
        </div>
      </div>
    );
  });
}

// 시각 표기는 전부 서울 고정 포맷터를 쓴다. 로컬 타임존으로 렌더하면 서버(UTC)와 어긋나
// 하이드레이션이 깨진다 — src/lib/time.ts 주석 참고.

function fullTime(iso: string | null): string {
  if (!iso) return '기록 없음';
  return seoulMonthDayTime(iso);
}

/**
 * 목록용 짧은 시각 — 오늘이면 시:분, 아니면 월/일.
 *
 * "오늘" 판정에 현재 시각을 쓰므로 서버 렌더와 하이드레이션이 자정을 사이에 두고 갈리면
 * 여전히 어긋난다. 하루에 한 번, 그것도 1초 미만의 창이라 감수한다 —
 * 9시간씩 어긋나던 타임존 문제와 달리 실질적으로 발생하지 않는다.
 */
function shortTime(iso: string | null): string {
  if (!iso) return '';
  const key = seoulDateKey(iso);
  if (key === seoulDateKey(new Date())) return seoulClock(iso);
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
}
