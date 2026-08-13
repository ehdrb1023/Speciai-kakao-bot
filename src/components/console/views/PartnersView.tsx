'use client';

// 거래처 — 여기서는 회사명만 관리한다.
//
// 방↔거래처 연결은 카톡방 안에서 "#등록 <회사명>" 으로 만든다. 이 화면에서 방 이름 패턴을
// 손으로 맞추게 하지 않는 이유: 대괄호 하나 빠진 규칙이 섞이면 그 방은 아무 소리 없이
// 수집되지 않고, 몇 주 뒤에야 "왜 이 방만 안 들어오지" 로 발견된다.

import { useEffect, useRef, useState, useTransition } from 'react';
import { Ic } from '../IconDefs';
import { EmptyState } from '../EmptyState';
import { useTabActive } from '../tab-active';
import type { PartnerRow, RuleRow, BoundRoomRow } from '@/server/actions/partners';
import type { RoomRuleKind } from '@/server/kakao/rules';
import { seoulMonthDayTime } from '@/lib/time';
import { isGeneratedRoomName } from '@/server/kakao/rules';

/**
 * 화면에 보여줄 방 이름.
 *
 * 이 단말의 카톡 알림에는 방 제목이 없어서 봇이 알림 식별자로 `방#<열쇠>` 를 지어 보낸다.
 * 매칭에는 그 값이 그대로 필요하지만 사람에게는 아무 의미가 없다. 목록에서는 거래처명으로
 * 바꿔 보여주고, 열쇠는 마우스를 올렸을 때만 보이게 둔다(같은 거래처 방이 둘일 때 구분용).
 */
function roomLabel(roomName: string, partnerName?: string): string {
  if (!isGeneratedRoomName(roomName)) return roomName;
  return partnerName ? `${partnerName} 카톡방` : '카톡방';
}

export interface UnmatchedRoom {
  id: string;
  roomName: string;
  hitCount: number;
  lastSeenAt: string;
}

export interface PartnersActions {
  createPartner: (input: { name: string }) => Promise<{ error?: string }>;
  deletePartner: (id: string) => Promise<{ error?: string }>;
  linkRoom: (input: { partnerId: string; roomName: string }) => Promise<{ error?: string }>;
  unlinkRoom: (ruleId: string) => Promise<{ error?: string }>;
  adoptUnmatchedRoom: (input: {
    unmatchedId: string;
    partnerId: string;
  }) => Promise<{ error?: string }>;
  dismissUnmatchedRoom: (id: string) => Promise<{ error?: string }>;
}

const KIND_LABELS: Record<RoomRuleKind, string> = {
  prefix: '접두어',
  exact: '완전일치',
  contains: '포함',
  regex: '정규식',
};

/**
 * 거래처 목록 폴링 주기.
 *
 * 이 화면의 핵심 사건(`#등록`)은 브라우저 밖 — 카톡방 안에서 일어난다. 서버 렌더 결과만
 * 들고 있으면 명령을 치고 돌아와도 화면이 그대로라, 사람은 새로고침을 해야 붙었는지를 안다.
 * 안내문이 "방에서 #등록 을 치세요" 라고 시키는 화면이므로 그 결과는 여기서 보여야 한다.
 */
const POLL_MS = 10_000;
// 아무것도 안 바뀌면 주기를 늘린다. 거래처 등록은 하루에 몇 번이라 대부분의 응답이 "변한 것 없음"
// 이고, 그 빈 응답 하나하나가 서버리스 호출로 과금된다.
const POLL_MAX_MS = 60_000;

/** 목록이 실제로 달라졌는지 보는 값싼 지문. 같으면 다시 그리지 않는다. */
function fingerprint(partners: PartnerRow[], unmatched: UnmatchedRoom[]): string {
  return [
    ...partners.map((p) => `${p.id}:${p.name}:${p.roomCount}:${p.rooms.map((r) => r.ruleId).join(',')}`),
    ...unmatched.map((u) => `u${u.id}:${u.hitCount}`),
  ].join('|');
}

export function PartnersView({
  partners,
  unmatched,
  canEdit,
  actions,
}: {
  partners: PartnerRow[];
  unmatched: UnmatchedRoom[];
  canEdit: boolean;
  actions: PartnersActions;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState('');

  // 서버가 준 값이 출발점이고, 폴링이 그 위를 덮는다. 액션(추가·삭제·연결)은 revalidatePath 로
  // 새 props 를 내려주므로 그때는 props 쪽이 최신이다.
  const [live, setLive] = useState({ partners, unmatched });
  useEffect(() => {
    setLive({ partners, unmatched });
  }, [partners, unmatched]);

  const liveRef = useRef(live);
  liveRef.current = live;
  // 다른 탭을 보는 동안에는 이 화면이 살아만 있고 네트워크는 쓰지 않는다(tab-active.tsx 참고).
  const tabActive = useTabActive();
  const tabActiveRef = useRef(tabActive);
  tabActiveRef.current = tabActive;
  const pollNowRef = useRef<(() => Promise<void>) | null>(null);
  // 쓰기가 진행 중이면 그 주기는 건너뛴다 — 방금 누른 것이 폴링 결과에 덮여 되돌아가지 않게.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  function run(fn: () => Promise<{ error?: string }>, okMsg: string) {
    start(async () => {
      const res = await fn();
      setMsg(res.error ? `실패: ${res.error}` : okMsg);
    });
  }

  useEffect(() => {
    let stopped = false;
    // 연속으로 "변한 것 없음" 이 나온 횟수. 늘어날수록 주기를 두 배씩 늘린다.
    let idleStreak = 0;

    function nextDelay() {
      let delay = POLL_MS;
      for (let i = 0; i < idleStreak && delay < POLL_MAX_MS; i++) delay *= 2;
      return Math.min(delay, POLL_MAX_MS);
    }

    async function poll() {
      if (stopped) return;
      // 안 보이는 동안은 부르지 않는다. 다만 주기는 되돌려둔다 — 돌아왔을 때 느린 채로
      // 시작하면 "새로고침해야 뜨네" 로 느껴진다.
      // 다른 탭(받은 카톡·봇 연동)을 보는 중일 때도 같다. 이 화면은 살아 있지만 아무도 안 본다.
      if (document.visibilityState !== 'visible' || !tabActiveRef.current) {
        idleStreak = 0;
        return;
      }
      if (pendingRef.current) return;

      try {
        const res = await fetch('/api/kakao/partners', { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { partners?: PartnerRow[]; unmatched?: UnmatchedRoom[] };
        if (!json.partners || stopped) return;

        const next = { partners: json.partners, unmatched: json.unmatched ?? [] };
        const cur = liveRef.current;
        if (fingerprint(next.partners, next.unmatched) === fingerprint(cur.partners, cur.unmatched)) {
          // 붙기를 기다리는 중(연결된 방이 없는 거래처가 있거나 미분류 방이 있음)이면 늦추지
          // 않는다. 사람은 카톡방에서 #등록 을 치고 이 화면을 보고 있고, 그동안 브라우저는
          // 계속 보이는 상태라 visibilitychange 로 되돌아올 기회가 없다.
          const waiting =
            cur.partners.some((p) => p.rooms.length === 0) || cur.unmatched.length > 0;
          idleStreak = waiting ? 0 : idleStreak + 1;
          return;
        }
        idleStreak = 0;
        setLive(next);
      } catch {
        // 네트워크가 끊긴 것뿐이다. 다음 주기에 다시 시도한다.
      }
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      idleStreak = 0;
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

  // 이 탭으로 돌아온 순간 즉시 한 번. 다른 탭에 있는 동안 멈춰둔 만큼 화면이 뒤처져 있다.
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

  return (
    <>
      <div className="vhead">
        <h1>거래처</h1>
        <div className="sub">
          여기에 회사명을 등록하고, 카톡방에서 <b>#등록 회사명</b> 을 한 번 치면 그 방부터 수집됩니다.
        </div>
      </div>

      {msg ? (
        <div className="noterow" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      ) : null}

      <HowTo />

      {/* 미분류 방 — 아직 어느 거래처에도 안 붙은 방 */}
      {live.unmatched.length > 0 ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sh" style={{ marginBottom: 10 }}>
            <Ic id="i-flag" w={15} />
            <b>연결 안 된 방 {live.unmatched.length}개</b>
          </div>
          <div className="fhint" style={{ marginBottom: 10 }}>
            봇이 본 적 있지만 어느 거래처에도 안 붙은 <b>단톡방</b>입니다. 없는 회사명으로
            <b>#등록</b> 을 친 방도 여기 나옵니다(오타 확인용). 개인 1:1 카톡은 올라오지 않습니다.
            본문은 저장하지 않았습니다 — 붙여도 지난 대화는 되살아나지 않고 그 이후부터 쌓입니다.
          </div>
          <div className="list">
            {live.unmatched.map((u) => (
              <UnmatchedRow
                key={u.id}
                room={u}
                partners={live.partners}
                canEdit={canEdit}
                pending={pending}
                onAdopt={(partnerId) =>
                  run(
                    () => actions.adoptUnmatchedRoom({ unmatchedId: u.id, partnerId }),
                    '연결했어요. 다음 메시지부터 이 거래처로 모입니다.',
                  )
                }
                onDismiss={() => run(() => actions.dismissUnmatchedRoom(u.id), '목록에서 내렸어요.')}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 거래처 추가 — 회사명만 */}
      {canEdit ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sh" style={{ marginBottom: 10 }}>
            <Ic id="i-plus" w={15} />
            <b>거래처 추가</b>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="fld" style={{ flex: '1 1 240px', marginBottom: 0 }}>
              <label htmlFor="p-name">회사명</label>
              <input
                id="p-name"
                className="tin"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="삼성전자"
              />
            </div>
            <button
              type="button"
              className="btn pri"
              disabled={pending || !newName.trim()}
              onClick={() =>
                run(async () => {
                  const res = await actions.createPartner({ name: newName });
                  if (!res.error) setNewName('');
                  return res;
                }, '거래처를 추가했어요. 이제 그 카톡방에서 #등록 으로 붙이세요.')
              }
            >
              추가
            </button>
          </div>
          <div className="fhint">
            방 안에서 <b>#등록</b> 으로 붙일 때는 여기 적은 이름 그대로 쳐야 합니다.{' '}
            <b>삼성전자</b> 로 등록했으면 <b>#등록 삼성전자</b> 입니다.
          </div>
        </div>
      ) : null}

      {/* 거래처 목록 */}
      {live.partners.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="i-bldg"
            title="등록된 거래처가 없어요"
            desc="회사명을 먼저 추가하세요. 그 다음 카톡방에서 #등록 회사명 을 치면 그 방부터 수집됩니다."
          />
        </div>
      ) : (
        <div className="list">
          {live.partners.map((p) => (
            <PartnerCard
              key={p.id}
              partner={p}
              canEdit={canEdit}
              pending={pending}
              onUnlink={(ruleId) =>
                run(() => actions.unlinkRoom(ruleId), '연결을 끊었어요. 이 방은 더 이상 수집되지 않습니다.')
              }
              onDelete={() => run(() => actions.deletePartner(p.id), '거래처를 지웠어요.')}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** 처음 쓰는 사람이 순서를 틀리지 않게 하는 3단계 안내. */
function HowTo() {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="sh" style={{ marginBottom: 10 }}>
        <Ic id="i-check" w={15} />
        <b>연결하는 법</b>
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9 }}>
        <li>
          아래에서 <b>회사명</b>을 등록합니다.
        </li>
        <li>
          그 카톡방에서 <b>#등록 회사명</b> 을 한 번 칩니다. 여기 등록한 이름 그대로 쳐야 합니다.
        </li>
        <li>
          이때부터 그 방 대화가 이 회사로 모입니다. 끊을 때는 <b>#등록해제</b> 입니다.
        </li>
      </ol>
      <div className="fhint">
        <b>#등록</b> 을 치면 이 화면은 몇 초 안에 저절로 갱신됩니다 — 새로고침하지 않아도 됩니다.
      </div>
      <div className="fhint">
        <b>봇이 설치된 폰의 주인이 직접 치면 안 됩니다</b> — 자기 발화는 알림에 뜨지 않아 봇이
        못 봅니다. 방의 다른 사람이 쳐야 합니다.
        <br />
        이 단말의 카톡 알림에는 방 제목이 실려오지 않아서, 봇은 알림 자체의 식별자로 방을
        구분합니다. 그래서 <b>#등록</b> 이 방을 지목하는 유일한 방법이고, 화면에 보이는 이름은
        그때 친 회사명입니다.
      </div>
    </div>
  );
}

function PartnerCard({
  partner,
  canEdit,
  pending,
  onUnlink,
  onDelete,
}: {
  partner: PartnerRow;
  canEdit: boolean;
  pending: boolean;
  onUnlink: (ruleId: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="cav">{partner.name.charAt(0)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14, fontWeight: 800 }}>{partner.name}</b>
          <div className="pl-v" style={{ fontSize: 11.5, color: 'var(--mut)' }}>
            연결된 방 {partner.rooms.length}개 · 수집 중인 방 {partner.roomCount}개
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="chipx rd"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `"${partner.name}" 거래처를 지울까요? 방 연결도 함께 끊깁니다. 모아둔 대화는 남습니다.`,
                )
              ) {
                onDelete();
              }
            }}
          >
            삭제
          </button>
        ) : null}
      </div>

      {partner.rooms.length === 0 ? (
        <div className="fhint" style={{ color: '#C2410C' }}>
          연결된 방이 없습니다. 카톡방에서 <b>#등록 {partner.name}</b> 을 치세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {partner.rooms.map((r: BoundRoomRow) => (
            <span key={r.ruleId} className="chipx wt" title={r.roomName}>
              {roomLabel(r.roomName, partner.name)}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${roomLabel(r.roomName, partner.name)} 연결 해제`}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`"${roomLabel(r.roomName, partner.name)}" 의 수집을 멈출까요? 모아둔 대화는 남습니다.`)) {
                      onUnlink(r.ruleId);
                    }
                  }}
                  style={{ marginLeft: 4, color: 'var(--fnt)', fontWeight: 800 }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {partner.legacyRules.length > 0 ? (
        <LegacyRules rules={partner.legacyRules} canEdit={canEdit} pending={pending} onUnlink={onUnlink} />
      ) : null}
    </div>
  );
}

/**
 * 방 이름 패턴을 손으로 등록하던 시절의 규칙. 새로 만들 수는 없지만 남아 있으면 계속
 * 매칭되므로, 보이지 않게 두면 "#등록해제 했는데 왜 계속 들어오지" 가 된다.
 */
function LegacyRules({
  rules,
  canEdit,
  pending,
  onUnlink,
}: {
  rules: RuleRow[];
  canEdit: boolean;
  pending: boolean;
  onUnlink: (ruleId: string) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="fhint" style={{ marginBottom: 6 }}>
        예전 패턴 규칙 {rules.length}개 — 이 패턴에 걸리는 방은 <b>#등록</b> 없이도 수집됩니다. 지금
        방식으로 정리하려면 지우고 방에서 <b>#등록</b> 을 치세요.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {rules.map((r) => (
          <span key={r.id} className="chipx gy">
            {KIND_LABELS[r.kind]} · {r.pattern}
            {canEdit ? (
              <button
                type="button"
                aria-label="예전 규칙 삭제"
                disabled={pending}
                onClick={() => onUnlink(r.id)}
                style={{ marginLeft: 4, color: 'var(--fnt)', fontWeight: 800 }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function UnmatchedRow({
  room,
  partners,
  canEdit,
  pending,
  onAdopt,
  onDismiss,
}: {
  room: UnmatchedRoom;
  partners: PartnerRow[];
  canEdit: boolean;
  pending: boolean;
  onAdopt: (partnerId: string) => void;
  onDismiss: () => void;
}) {
  const [picked, setPartnerId] = useState('');
  // 목록이 폴링으로 나중에 채워질 수 있다. 고른 적이 없으면 그때그때 첫 거래처를 기본값으로
  // 삼는다 — mount 시점 값으로 고정하면 "거래처 없음" 인 채 연결 버튼이 죽어 있는다.
  const partnerId = picked || partners[0]?.id || '';

  return (
    <div className="rowc" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span className="cav">
        <Ic id="i-bubble" w={16} />
      </span>
      <span className="cm">
        <b>{room.roomName}</b>
        <span className="mt">
          {room.hitCount}회 수신 · 마지막 {seoulMonthDayTime(room.lastSeenAt)}
        </span>
      </span>
      {canEdit ? (
        <>
          <select
            className="tin"
            style={{ flex: '0 0 160px' }}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            aria-label="거래처 선택"
          >
            {partners.length === 0 ? <option value="">거래처 없음</option> : null}
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn pri sm"
            disabled={pending || !partnerId}
            onClick={() => onAdopt(partnerId)}
          >
            연결
          </button>
        </>
      ) : null}
      <button type="button" className="chipx gy" disabled={pending} onClick={onDismiss}>
        무시
      </button>
    </div>
  );
}
