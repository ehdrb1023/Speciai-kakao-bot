'use client';

// 받은 카톡 — 좌(방 목록) · 중(대화) · 우(방 정보) 3분할.
// 레이아웃·클래스는 advisor 콘솔의 .console / .cs-left / .cs-mid / .cs-right 를 그대로 쓴다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '../IconDefs';
import { EmptyState } from '../EmptyState';
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
 * 방 목록 폴링 주기.
 *
 * 실측(2026-08-11): 카톡 발신 → 봇 폰 알림 7초 → 대시보드 반영까지 총 17초.
 * 뒤쪽 10초가 이 주기 때문이라 30초에서 10초로 줄였다. 요청은 3배가 되지만 목록만
 * 받아오는 호출이라 Vercel Pro 포함량의 몇 %다.
 *
 * 더 줄여도 체감은 별로 나아지지 않는다 — 앞단의 알림 7초가 남아 있어서다.
 * 그 아래로 내리려면 폴링이 아니라 Supabase Realtime 으로 바꿔야 한다.
 */
const POLL_MS = 10_000;
// 아무것도 안 바뀌면 주기를 늘린다. 거래처 메시지는 시간당 몇 건이라 10초 고정이면 응답의
// 대부분이 "변한 것 없음" 이고, 그 빈 응답 하나하나가 서버리스 호출로 과금된다
// (미들웨어가 매 요청 Supabase auth 왕복을 한 번 더 한다). 새 메시지가 오거나 탭으로
// 돌아오거나 발신 대기가 생기면 곧바로 10초로 되돌아온다.
const POLL_MAX_MS = 60_000;

const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'gray'] as const;
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
   * 탭이 보일 때만 돈다. 사무실에서 하루종일 열어두는 화면이라, 백그라운드 탭·잠긴 화면에서도
   * 계속 부르면 아무도 안 보는 응답을 밤새 만들어내게 된다.
   *
   * 보이는 동안에도 변화가 없으면 10초 → 20 → 40 → 60초로 늦춘다. 거래처 메시지는 시간당
   * 몇 건이라 10초 고정이면 응답의 대부분이 빈 응답이고, 그 하나하나가 서버리스 호출로
   * 과금된다(미들웨어가 매 요청 Supabase auth 왕복을 한 번 더 한다). 새 메시지·발신 대기·
   * 탭 복귀 중 하나만 있어도 즉시 10초로 돌아오므로 체감은 그대로다.
   */
  useEffect(() => {
    let stopped = false;
    // 연속으로 "변한 것 없음" 이 나온 횟수. 늘어날수록 주기를 두 배씩 늘린다.
    let idleStreak = 0;
    let lastFingerprint = '';

    function nextDelay() {
      // 다른 탭을 보는 중이면 배지·알림을 위한 최소한만 — 가장 느린 주기로 목록만 확인한다.
      if (!tabActiveRef.current) return POLL_MAX_MS;
      let delay = POLL_MS;
      for (let i = 0; i < idleStreak && delay < POLL_MAX_MS; i++) delay *= 2;
      return Math.min(delay, POLL_MAX_MS);
    }

    /** 목록이 실제로 달라졌는지 보는 값싼 지문. 전체 비교 대신 이것만 본다. */
    function fingerprint(list: InboxRoom[]) {
      return list.map((r) => `${r.id}:${r.lastMessageAt ?? ''}:${r.messageCount}`).join('|');
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
      // 창이 안 보이는 동안은 부르지 않는다. 다만 주기는 되돌려둔다 — 돌아왔을 때 느린 채로
      // 시작하면 "새로고침해야 뜨네" 로 느껴진다.
      if (document.visibilityState !== 'visible') { idleStreak = 0; return; }
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

        // 발신 대기가 남아 있으면 사람이 "나갔나" 를 기다리는 중이다. 늦추지 않는다.
        const fp = fingerprint(next);
        if (fp !== lastFingerprint || pendingRef.current) idleStreak = 0;
        else idleStreak += 1;
        lastFingerprint = fp;

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

    // 탭으로 돌아오면 30초를 기다리지 않고 즉시 한 번 — 다른 일 하다 온 사이 쌓인 것을 바로 보여준다.
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      idleStreak = 0; // 돌아오자마자는 빠르게
      void poll();
    }

    pollNowRef.current = async () => {
      idleStreak = 0;
      await poll();
    };

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
          '수집 자체를 멈추려면 거래처 탭에서 방 연결을 끊거나 카톡방에서 #등록해제 를 치세요.',
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

  if (rooms.length === 0) {
    return (
      <div className="console" style={{ display: 'block', height: 'auto' }}>
        <div className="card">
          <EmptyState
            icon="i-bubble"
            title="아직 수집된 카톡방이 없어요"
            desc={
              data.unmatchedCount > 0
                ? `봇이 방 ${data.unmatchedCount}개를 봤지만 어느 거래처에도 연결되지 않았어요. 거래처 탭에서 회사명을 등록한 뒤, 그 방에서 #등록 회사명 을 치세요.`
                : '거래처 탭에서 회사명을 등록하고, 카톡방에서 #등록 회사명 을 한 번 치면 여기에 대화가 쌓입니다.'
            }
            action={
              <button type="button" className="btn pri sm" onClick={() => navigateConsole('partners')}>
                <Ic id="i-plus" w={14} />
                거래처 등록하러 가기
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="console">
      {/* ── 좌: 방 목록 ── */}
      <aside className="cs-left">
        <div className="csearch">
          <Ic id="i-search" w={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처·방 이름 검색"
            aria-label="방 검색"
          />
        </div>

        <div className="filters" style={{ justifyContent: 'flex-start', margin: '0 4px 8px', gap: 6 }}>
          <button type="button" className={`fchip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            전체 {rooms.length}
          </button>
          <button
            type="button"
            className={`fchip${filter === 'unhandled' ? ' on' : ''}`}
            onClick={() => setFilter('unhandled')}
          >
            미처리 {unhandledCount}
          </button>
          <button
            type="button"
            className={`fchip${filter === 'pinned' ? ' on' : ''}`}
            onClick={() => setFilter('pinned')}
          >
            고정
          </button>
        </div>

        {data.unmatchedCount > 0 ? (
          <button
            type="button"
            className="csmeta"
            style={{ textAlign: 'left', color: '#C2410C' }}
            onClick={() => navigateConsole('partners')}
          >
            연결 안 된 방 {data.unmatchedCount}개 — 연결하러 가기
          </button>
        ) : null}

        {visibleRooms.length === 0 ? (
          <div className="csmeta">조건에 맞는 방이 없어요.</div>
        ) : (
          visibleRooms.map((room) => (
            // 숨기기 버튼을 안에 두어야 해서 div 다 — button 안에 button 은 넣을 수 없다.
            <div
              key={room.id}
              role="button"
              tabIndex={0}
              className={`room${room.id === activeId ? ' on' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => void openRoom(room.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void openRoom(room.id);
                }
              }}
            >
              <span className={`ci${room.color ? ` c-${room.color}` : ''}`}>
                <Ic id="i-bubble" w={17} />
              </span>
              <span className="cm">
                <span className="nm">
                  {room.pinned ? <span className="pinmark">고정</span> : null}
                  {room.partnerName ?? '거래처 연결 안 됨'}
                  {!room.handled ? <span className="live" /> : null}
                </span>
                <span className="rmnm">{room.roomName}</span>
                <span className="pv">{room.preview || '내용 없음'}</span>
              </span>
              <span className="cr2">
                <span className="rtime">{shortTime(room.lastMessageAt)}</span>
                {!room.handled ? <span className="drafttag">미처리</span> : null}
                <button
                  type="button"
                  className="roomdel"
                  aria-label={`${room.roomName} 목록에서 내리기`}
                  title="목록에서 내리기"
                  onClick={(e) => {
                    e.stopPropagation();
                    void hideRoom(room.id);
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ))
        )}
      </aside>

      {/* ── 중: 대화 ── */}
      <section className="cs-mid">
        {active ? (
          <>
            <header className="cmh">
              <div>
                <b>{active.partnerName ?? '거래처 연결 안 됨'}</b>
                <div className="sub">
                  {active.roomName} · 메시지 {active.messageCount}건
                </div>
              </div>
              <div className="rgt">
                <div className="colorpick">
                  <button
                    type="button"
                    className={`cpbtn${active.color ? ` c-${active.color}` : ''}`}
                    onClick={() => setColorOpen((v) => !v)}
                  >
                    <span className="cpdot" />
                    {active.color ? COLOR_LABELS[active.color] : '색상'}
                  </button>
                  {colorOpen ? (
                    <div className="cppop">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`cpopt c-${c}${active.color === c ? ' on' : ''}`}
                          onClick={() => {
                            setColorOpen(false);
                            void patchRoom(active.id, { color: c });
                          }}
                        >
                          <span className="cpdot" />
                          {COLOR_LABELS[c]}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="cpopt none"
                        onClick={() => {
                          setColorOpen(false);
                          void patchRoom(active.id, { color: null });
                        }}
                      >
                        색 없음
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`chipx gy${active.pinned ? ' on' : ''}`}
                  onClick={() => void patchRoom(active.id, { pinned: !active.pinned })}
                >
                  {active.pinned ? '고정 해제' : '상단 고정'}
                </button>
                <button
                  type="button"
                  className={`chipx ${active.handled ? 'gr' : 'am'}`}
                  onClick={() => void patchRoom(active.id, { handled: !active.handled })}
                >
                  <Ic id="i-check" w={11} />
                  {active.handled ? '처리완료' : '처리완료로 표시'}
                </button>
              </div>
            </header>

            <div className="chat" ref={chatRef}>
              {loading && !activeMessages ? (
                <div className="botline">
                  <span className="spin" />
                  대화를 불러오는 중…
                </div>
              ) : null}
              {renderMessages(activeMessages ?? [], data.staffLabel)}
              {renderOutbound(activeOutbound, (id) => void cancelOutbound(id))}
            </div>

            {sendError ? <div className="sendwarn">{sendError}</div> : null}

            <div className="cs-in">
              {!data.canSend ? (
                <div className="guard">
                  <Ic id="i-lock" w={14} />
                  <span>열람 권한이라 보낼 수 없어요. 답장은 카카오톡에서 직접 보내주세요.</span>
                </div>
              ) : !active.partnerId ? (
                <div className="guard">
                  <Ic id="i-lock" w={14} />
                  <span>거래처에 연결되지 않은 방이에요. 카톡방에서 #등록 을 먼저 해주세요.</span>
                </div>
              ) : (
                <div className="composer">
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
                    placeholder={`${active.partnerName ?? active.roomName} 에게 보낼 내용 (Enter 전송 · Shift+Enter 줄바꿈)`}
                    rows={1}
                    maxLength={2000}
                  />
                  <button
                    type="button"
                    className="sendbtn"
                    disabled={sending || !draft.trim()}
                    onClick={() => void sendDraft()}
                  >
                    {sending ? '보내는 중…' : '보내기'}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="chat">
            <div className="botline">왼쪽에서 방을 고르면 대화가 표시됩니다.</div>
          </div>
        )}
      </section>

      {/* ── 우: 방 정보 ── */}
      <aside className="cs-right">
        <div className="sc">
          <div className="sh">
            <Ic id="i-bldg" w={15} />
            <b>방 정보</b>
          </div>
          {active ? (
            <div className="plist">
              <div className="pl-row">
                <span className="pl-k">거래처</span>
                <span className={`pl-v${active.partnerName ? '' : ' pl-warn'}`}>
                  {active.partnerName ?? '연결 안 됨'}
                </span>
              </div>
              <div className="pl-row">
                <span className="pl-k">방 제목</span>
                <span className="pl-v">{active.roomName}</span>
              </div>
              <div className="pl-row">
                <span className="pl-k">메시지</span>
                <span className="pl-v">{active.messageCount}건</span>
              </div>
              <div className="pl-row">
                <span className="pl-k">마지막</span>
                <span className="pl-v">{fullTime(active.lastMessageAt)}</span>
              </div>
              <div className="pl-row">
                <span className="pl-k">상태</span>
                <span className={`pl-v${active.handled ? '' : ' pl-warn'}`}>
                  {active.handled ? '처리완료' : '미처리'}
                </span>
              </div>
            </div>
          ) : (
            <div className="placeholder">방을 고르면 정보가 표시됩니다.</div>
          )}
        </div>

        <div className="sc">
          <div className="sh">
            <Ic id="i-clock" w={15} />
            <b>최근 수신</b>
            <span className="mini">{rooms.length}방</span>
          </div>
          <div className="recentlist">
            {rooms.slice(0, 20).map((room) => (
              <button
                key={room.id}
                type="button"
                className={`recentrow${room.id === activeId ? ' on' : ''}`}
                onClick={() => void openRoom(room.id)}
              >
                <span className="rr-top">
                  <span className="rr-name">{room.partnerName ?? room.roomName}</span>
                  <span className="rr-time">{shortTime(room.lastMessageAt)}</span>
                </span>
                <span className="rr-pv">{room.preview || '내용 없음'}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** 날짜가 바뀌는 지점에 구분선을 넣고, 같은 사람의 연속 발화는 묶는다(카톡과 같은 읽기 리듬). */
function renderMessages(messages: InboxMessage[], staffLabel: string) {
  if (messages.length === 0) {
    return <div className="botline">아직 이 방에 저장된 대화가 없어요.</div>;
  }

  const out: React.ReactNode[] = [];
  let lastDay = '';
  let lastSpeaker = '';

  for (const m of messages) {
    const day = dayKey(m.sentAt);
    if (day !== lastDay) {
      out.push(
        <div key={`d-${m.id}`} className="daydiv">
          {dayLabel(m.sentAt)}
        </div>,
      );
      lastDay = day;
      lastSpeaker = '';
    }

    const grouped = m.speaker === lastSpeaker;
    lastSpeaker = m.speaker;

    out.push(
      <div key={m.id} className={`msg${m.side === 'us' ? ' out' : ''}${grouped ? ' grouped' : ''}`}>
        <span className={`mav${grouped ? ' ghost' : ''}`}>{grouped ? '' : m.speaker.charAt(0)}</span>
        <div className="mbody">
          <div className={`who${grouped ? ' tiny' : ''}`}>
            {grouped ? '' : m.side === 'us' ? `${m.speaker} · ${staffLabel}` : m.speaker}
            <span className="tm">{clockTime(m.sentAt)}</span>
          </div>
          <div className="bubble">
            {m.attachment?.url ? (
              <img
                src={m.attachment.url}
                alt={m.attachment.name}
                style={{ maxWidth: '100%', borderRadius: 10, marginBottom: m.body ? 6 : 0 }}
              />
            ) : null}
            {m.body}
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
      <div key={o.id} className={`msg out pendingmsg${failed ? ' failedmsg' : ''}`}>
        <span className="mav ghost" />
        <div className="mbody">
          <div className="who tiny">
            <span className="tm">
              {failed
                ? `보내지 못했어요 (${o.attempts}회 시도)`
                : o.status === 'sending'
                  ? '보내는 중…'
                  : '전송 대기'}
            </span>
          </div>
          <div className="bubble">{o.body}</div>
          <div className="obact">
            <button type="button" className="obcancel" onClick={() => onCancel(o.id)}>
              {failed ? '지우기' : '취소'}
            </button>
          </div>
        </div>
      </div>
    );
  });
}

// 아래 넷은 전부 서울 고정 포맷터를 쓴다. 로컬 타임존으로 렌더하면 서버(UTC)와 어긋나
// 하이드레이션이 깨진다 — src/lib/time.ts 주석 참고.

function dayKey(iso: string): string {
  return seoulDateKey(iso);
}

function dayLabel(iso: string): string {
  return seoulDayLabel(iso);
}

function clockTime(iso: string): string {
  return seoulClock(iso);
}

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
