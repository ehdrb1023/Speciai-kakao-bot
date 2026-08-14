'use client';

// 거래처 — 여기서는 회사명만 관리한다.
//
// 방↔거래처 연결은 카톡방 안에서 "#등록 <회사명>" 으로 만든다. 이 화면에서 방 이름 패턴을
// 손으로 맞추게 하지 않는 이유: 대괄호 하나 빠진 규칙이 섞이면 그 방은 아무 소리 없이
// 수집되지 않고, 몇 주 뒤에야 "왜 이 방만 안 들어오지" 로 발견된다.
//
// 미분류(연결 안 된) 방 목록은 연결 진단 탭(LinkView)에 있다.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTabActive } from '../tab-active';
import type { PartnerRow, RuleRow, BoundRoomRow } from '@/server/actions/partners';
import type { RoomRuleKind } from '@/server/kakao/rules';
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

export interface PartnersActions {
  createPartner: (input: { name: string }) => Promise<{ error?: string }>;
  deletePartner: (id: string) => Promise<{ error?: string }>;
  linkRoom: (input: { partnerId: string; roomName: string }) => Promise<{ error?: string }>;
  unlinkRoom: (ruleId: string) => Promise<{ error?: string }>;
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

export interface UnmatchedLite {
  id: string;
  hitCount: number;
}

/** 목록이 실제로 달라졌는지 보는 값싼 지문. 같으면 다시 그리지 않는다. */
function fingerprint(partners: PartnerRow[], unmatched: UnmatchedLite[]): string {
  return [
    ...partners.map((p) => `${p.id}:${p.name}:${p.roomCount}:${p.rooms.map((r) => r.ruleId).join(',')}`),
    ...unmatched.map((u) => `u${u.id}:${u.hitCount}`),
  ].join('|');
}

export function PartnersView({
  partners,
  canEdit,
  actions,
}: {
  partners: PartnerRow[];
  canEdit: boolean;
  actions: PartnersActions;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState('');

  // 서버가 준 값이 출발점이고, 폴링이 그 위를 덮는다. 액션(추가·삭제·연결)은 revalidatePath 로
  // 새 props 를 내려주므로 그때는 props 쪽이 최신이다.
  const [live, setLive] = useState(partners);
  useEffect(() => {
    setLive(partners);
  }, [partners]);

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
      // 다른 탭(받은 카톡·연결 진단)을 보는 중일 때도 같다. 이 화면은 살아 있지만 아무도 안 본다.
      if (document.visibilityState !== 'visible' || !tabActiveRef.current) {
        idleStreak = 0;
        return;
      }
      if (pendingRef.current) return;

      try {
        const res = await fetch('/api/kakao/partners', { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { partners?: PartnerRow[]; unmatched?: UnmatchedLite[] };
        if (!json.partners || stopped) return;

        const next = json.partners;
        const cur = liveRef.current;
        if (fingerprint(next, []) === fingerprint(cur, [])) {
          // 붙기를 기다리는 중(연결된 방이 없는 거래처가 있음)이면 늦추지 않는다. 사람은
          // 카톡방에서 #등록 을 치고 이 화면을 보고 있고, 그동안 브라우저는 계속 보이는
          // 상태라 visibilitychange 로 되돌아올 기회가 없다.
          const waiting = cur.some((p) => p.rooms.length === 0);
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
    <div className="stack">
      {msg ? <div className="note">{msg}</div> : null}

      {/* 거래처 추가 + 연결하는 법 */}
      {canEdit ? (
        <div className="card">
          <div className="card-h">
            <div>
              <h2>거래처 추가</h2>
              <div className="desc">회사명만 등록합니다. 방 연결은 그 카톡방에서 #등록 회사명 으로 만듭니다.</div>
            </div>
          </div>
          <div className="card-b">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: '1 1 240px' }}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && newName.trim()) {
                    run(async () => {
                      const res = await actions.createPartner({ name: newName });
                      if (!res.error) setNewName('');
                      return res;
                    }, '거래처를 추가했어요. 이제 그 카톡방에서 #등록 으로 붙이세요.');
                  }
                }}
                placeholder="회사명 (예: 삼성전자)"
                aria-label="회사명"
              />
              <button
                type="button"
                className="btn primary"
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
            <div className="note" style={{ marginBottom: 0 }}>
              ① 여기에 회사명 등록 → ② 그 카톡방에서 <b>#등록 회사명</b> (등록한 이름 그대로) → ③ 그때부터 수집.
              끊을 때는 <b>#등록해제</b>. 명령 결과는 몇 초 안에 이 화면에 저절로 반영됩니다.
              <br />
              봇이 설치된 폰의 주인이 직접 치면 안 됩니다 — 자기 발화는 알림에 뜨지 않아 봇이 못 봅니다.
              방의 다른 사람이 쳐야 합니다.
            </div>
          </div>
        </div>
      ) : null}

      {/* 거래처 카드 */}
      {live.length === 0 ? (
        <div className="card">
          <div className="empty">
            <b>등록된 거래처가 없어요</b>
            <p>회사명을 먼저 추가하세요. 그 다음 카톡방에서 #등록 회사명 을 치면 그 방부터 수집됩니다.</p>
          </div>
        </div>
      ) : (
        <div className="grid3">
          {live.map((p) => (
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
    <div className="pcard">
      <div className="pn">{partner.name}</div>
      {canEdit ? (
        <button
          type="button"
          className="btn sm quiet pdel"
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

      <div className="rooms-in">
        {partner.rooms.length === 0 ? (
          <span className="tag amber">연결된 방 없음 — 카톡방에서 #등록 {partner.name}</span>
        ) : (
          partner.rooms.map((r: BoundRoomRow) => (
            <span key={r.ruleId} className="tag" title={r.roomName}>
              {roomLabel(r.roomName, partner.name)}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${roomLabel(r.roomName, partner.name)} 연결 해제`}
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `"${roomLabel(r.roomName, partner.name)}" 의 수집을 멈출까요? 모아둔 대화는 남습니다.`,
                      )
                    ) {
                      onUnlink(r.ruleId);
                    }
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))
        )}
      </div>

      {partner.legacyRules.length > 0 ? (
        <LegacyRules rules={partner.legacyRules} canEdit={canEdit} pending={pending} onUnlink={onUnlink} />
      ) : null}

      <div className="pr">
        <div>
          연결된 방<b>{partner.rooms.length}개</b>
        </div>
        <div>
          수집 중<b>{partner.roomCount}개</b>
        </div>
        <div>
          예전 규칙<b>{partner.legacyRules.length}건</b>
        </div>
      </div>
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
    <div style={{ marginTop: 10 }}>
      <div className="tiny muted" style={{ marginBottom: 6 }}>
        예전 패턴 규칙 — 이 패턴에 걸리는 방은 #등록 없이도 수집됩니다.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {rules.map((r) => (
          <span key={r.id} className="tag">
            {KIND_LABELS[r.kind]} · {r.pattern}
            {canEdit ? (
              <button type="button" aria-label="예전 규칙 삭제" disabled={pending} onClick={() => onUnlink(r.id)}>
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
