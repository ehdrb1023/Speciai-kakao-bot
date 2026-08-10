'use client';

// 받은 카톡 — 좌(방 목록) · 중(대화) · 우(방 정보) 3분할.
// 레이아웃·클래스는 advisor 콘솔의 .console / .cs-left / .cs-mid / .cs-right 를 그대로 쓴다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '../IconDefs';
import { EmptyState } from '../EmptyState';
import { navigateConsole } from '../nav';

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

export interface InboxViewData {
  rooms: InboxRoom[];
  messagesByRoom: Record<string, InboxMessage[]>;
  staffLabel: string;
  /** 규칙에 안 걸려 본문을 저장하지 않은 방 수. 0 이 아니면 규칙 누락 신호다. */
  unmatchedCount: number;
}

type Filter = 'all' | 'unhandled' | 'pinned';

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
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [colorOpen, setColorOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const active = rooms.find((r) => r.id === activeId) ?? null;
  const activeMessages = activeId ? messages[activeId] : undefined;

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

  // 방을 고르면 대화를 지연 로드한다. 초기 렌더에는 첫 방만 실려 있다.
  const openRoom = useCallback(
    async (roomId: string) => {
      setActiveId(roomId);
      setColorOpen(false);
      if (messages[roomId]) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/kakao/thread?roomId=${encodeURIComponent(roomId)}`);
        const json = (await res.json()) as { messages?: InboxMessage[] };
        setMessages((prev) => ({ ...prev, [roomId]: json.messages ?? [] }));
      } catch {
        setMessages((prev) => ({ ...prev, [roomId]: [] }));
      } finally {
        setLoading(false);
      }
    },
    [messages],
  );

  // 새 대화를 열면 맨 아래(최신)로. 카톡과 같은 읽기 시작점을 준다.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, activeMessages]);

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
    const res = await fetch('/api/kakao/room-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, ...patch }),
    });
    if (!res.ok) {
      // 실패하면 서버 상태를 모르는 채로 두지 않는다.
      window.location.reload();
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
                ? `봇이 방 ${data.unmatchedCount}개를 봤지만 등록된 거래처 규칙에 걸리지 않았어요. 거래처 탭에서 방 이름 규칙을 등록해 주세요.`
                : '거래처 탭에서 방 이름 규칙을 등록하고, 봇 연동 탭의 안내대로 봇 단말을 켜면 여기에 대화가 쌓입니다.'
            }
            action={
              <button type="button" className="btn pri sm" onClick={() => navigateConsole('partners')}>
                <Ic id="i-plus" w={14} />
                거래처 규칙 등록하러 가기
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
            미분류 방 {data.unmatchedCount}개 — 규칙 등록하기
          </button>
        ) : null}

        {visibleRooms.length === 0 ? (
          <div className="csmeta">조건에 맞는 방이 없어요.</div>
        ) : (
          visibleRooms.map((room) => (
            <button
              key={room.id}
              type="button"
              className={`room${room.id === activeId ? ' on' : ''}`}
              onClick={() => void openRoom(room.id)}
            >
              <span className={`ci${room.color ? ` c-${room.color}` : ''}`}>
                <Ic id="i-bubble" w={17} />
              </span>
              <span className="cm">
                <span className="nm">
                  {room.pinned ? <span className="pinmark">고정</span> : null}
                  {room.partnerName ?? '(미지정 거래처)'}
                  {!room.handled ? <span className="live" /> : null}
                </span>
                <span className="rmnm">{room.roomName}</span>
                <span className="pv">{room.preview || '내용 없음'}</span>
              </span>
              <span className="cr2">
                <span className="rtime">{shortTime(room.lastMessageAt)}</span>
                {!room.handled ? <span className="drafttag">미처리</span> : null}
              </span>
            </button>
          ))
        )}
      </aside>

      {/* ── 중: 대화 ── */}
      <section className="cs-mid">
        {active ? (
          <>
            <header className="cmh">
              <div>
                <b>{active.partnerName ?? '(미지정 거래처)'}</b>
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
            </div>

            <div className="cs-in">
              <div className="guard">
                <Ic id="i-lock" w={14} />
                <span>읽기 전용이에요. 답장은 카카오톡에서 직접 보내주세요.</span>
              </div>
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
                <span className="pl-v">{active.partnerName ?? '미지정'}</span>
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

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function fullTime(iso: string | null): string {
  if (!iso) return '기록 없음';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 목록용 짧은 시각 — 오늘이면 시:분, 아니면 월/일. */
function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}
