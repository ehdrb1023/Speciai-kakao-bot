'use client';

// 연결 진단 — ① 아직 어느 거래처에도 안 붙은 방(이름·횟수만 저장) ② 방 이름 매칭 확인
// ③ 봇 단말 연동 상태·설치 안내.
// 토큰 실제 값은 절대 내려보내지 않는다. 설정 여부(boolean)만 받아 표시한다.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTabActive } from '../tab-active';
import type { PartnerRow } from '@/server/actions/partners';
import { matchRoomRule, normalizeRoomName, type RoomRule, type RoomRuleKind } from '@/server/kakao/rules';
import { seoulFull, seoulMonthDayTime } from '@/lib/time';

export interface UnmatchedRoom {
  id: string;
  roomName: string;
  hitCount: number;
  lastSeenAt: string;
}

export interface LinkActions {
  adoptUnmatchedRoom: (input: { unmatchedId: string; partnerId: string }) => Promise<{ error?: string }>;
  dismissUnmatchedRoom: (id: string) => Promise<{ error?: string }>;
}

export interface LinkStatus {
  ingestTokenConfigured: boolean;
  /** KAKAO_WORKSPACE_ID 가 설정돼 있다. 설정돼 있으면 콘솔도 그 워크스페이스만 본다. */
  workspaceIdConfigured: boolean;
  /** 지금 보고 있는 워크스페이스 ID. 미설정일 때 넣을 값으로만 쓴다. */
  currentWorkspaceId: string;
  appUrl: string;
  /** "#등록" 으로 거래처에 붙은 방 수. 0 이면 봇이 모든 방을 걸러낸다. */
  linkedRoomCount: number;
  roomCount: number;
  messageCount: number;
  lastIngestAt: string | null;
}

const KIND_LABELS: Record<RoomRuleKind, string> = {
  prefix: '접두어',
  exact: '완전일치',
  contains: '포함',
  regex: '정규식',
};

// #등록 이 만드는 규칙의 우선순위. 서버(bindRoomToPartner)와 같은 값이다 — 남아 있는
// 접두어 규칙보다 먼저 걸리게 한다.
const BIND_PRIORITY = 100;

// 미분류 방 폴링 주기. 이 화면의 사건(#등록·새 미분류 방)도 브라우저 밖에서 일어난다.
const POLL_MS = 10_000;
const POLL_MAX_MS = 60_000;

export function LinkView({
  partners,
  unmatched,
  canEdit,
  actions,
  status,
}: {
  partners: PartnerRow[];
  unmatched: UnmatchedRoom[];
  canEdit: boolean;
  actions: LinkActions;
  status: LinkStatus;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [live, setLive] = useState({ partners, unmatched });
  useEffect(() => {
    setLive({ partners, unmatched });
  }, [partners, unmatched]);

  const liveRef = useRef(live);
  liveRef.current = live;
  const tabActive = useTabActive();
  const tabActiveRef = useRef(tabActive);
  tabActiveRef.current = tabActive;
  const pollNowRef = useRef<(() => Promise<void>) | null>(null);
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
    let idleStreak = 0;

    function nextDelay() {
      let delay = POLL_MS;
      for (let i = 0; i < idleStreak && delay < POLL_MAX_MS; i++) delay *= 2;
      return Math.min(delay, POLL_MAX_MS);
    }

    async function poll() {
      if (stopped) return;
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
        const fp = (v: typeof next) =>
          [
            ...v.partners.map((p) => `${p.id}:${p.rooms.map((r) => r.ruleId).join(',')}`),
            ...v.unmatched.map((u) => `u${u.id}:${u.hitCount}`),
          ].join('|');
        if (fp(next) === fp(cur)) {
          idleStreak = cur.unmatched.length > 0 ? 0 : idleStreak + 1;
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

  const ready = status.ingestTokenConfigured && status.workspaceIdConfigured && status.linkedRoomCount > 0;

  return (
    <div className="stack">
      {msg ? <div className="note">{msg}</div> : null}

      {/*
        예전에는 "환경변수가 이 화면과 다른 워크스페이스를 가리킨다" 는 경고를 띄우고, 고칠
        값으로 **보고 있는 사람의 워크스페이스 ID** 를 그대로 내밀었다. 그 안내를 그대로 따른
        결과 봇 수집이 통째로 빈 워크스페이스로 넘어갔다(2026-08-13). 화면이 스스로를 정답으로
        제시하면, 잘못된 화면을 보고 있는 사람일수록 확신을 갖고 설정을 망가뜨린다.

        지금은 환경변수가 앵커고 콘솔이 거기에 맞춘다(auth/server.ts). 그래서 "불일치" 라는
        상태 자체가 없다. 남은 실패는 앵커가 아예 없는 경우뿐이고, 그때만 알린다.
      */}
      {!status.workspaceIdConfigured ? (
        <div className="note bad">
          배포 환경변수 <code>KAKAO_WORKSPACE_ID</code> 가 비어 있습니다. 워크스페이스가 둘 이상이면
          봇 인입이 거부되고(<code>503</code>) 수집이 멈춥니다. 아래 값을 넣고 재배포하세요:{' '}
          <code>{status.currentWorkspaceId}</code> — 지금 보고 있는 이 화면의 워크스페이스이니,
          여기가 운영 콘솔이 맞는지 확인하고 넣으세요.
        </div>
      ) : null}

      <div className="split">
        {/* 연결 안 된 방 */}
        <div className="card">
          <div className="card-h">
            <div>
              <h2>아직 연결되지 않은 방 {live.unmatched.length > 0 ? live.unmatched.length : ''}</h2>
              <div className="desc">이름과 받은 횟수만 기록됩니다. 대화 내용은 저장되지 않습니다.</div>
            </div>
          </div>
          {live.unmatched.length === 0 ? (
            <div className="empty">
              <b>연결 안 된 방이 없어요</b>
              <p>봇이 새 방을 보면 여기에 이름과 수신 횟수만 올라옵니다. 개인 1:1 카톡은 올라오지 않습니다.</p>
            </div>
          ) : (
            live.unmatched.map((u) => (
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
            ))
          )}
          <div className="card-b" style={{ paddingTop: 16 }}>
            <div className="tiny muted">
              없는 회사명으로 #등록 을 친 방도 여기 나옵니다(오타 확인용). 봇은 이 폰에 오는 카톡을
              서버로 올리지만 거래처에 연결된 방만 저장합니다 — 그래서 개인 카톡방 이름이 여기 뜰 수
              있고, 연결하지만 않으면 대화는 남지 않습니다.
            </div>
          </div>
        </div>

        {/* 매칭 확인 */}
        <MatchTester partners={live.partners} />
      </div>

      {/* 연동 상태 */}
      <div className="card">
        <div className="card-h">
          <div>
            <h2>봇 단말</h2>
            <div className="desc">규칙을 받지 못한 상태에서는 어느 방으로도 보내지 않습니다.</div>
          </div>
          <span className="tag" style={{ flexShrink: 0 }}>
            수집 {status.roomCount}방 · 메시지 {status.messageCount}건 · 마지막{' '}
            {status.lastIngestAt ? seoulFull(status.lastIngestAt) : '없음'}
          </span>
        </div>
        <StatusLine ok={status.ingestTokenConfigured} label="KAKAO_INGEST_TOKEN 설정" hint="봇과 서버가 공유하는 머신 토큰" />
        <StatusLine
          ok={status.workspaceIdConfigured}
          label="KAKAO_WORKSPACE_ID 설정"
          hint="봇이 보낸 메시지를 쌓을 워크스페이스. 콘솔도 이 값이 가리키는 곳만 봅니다"
        />
        <StatusLine
          ok={status.linkedRoomCount > 0}
          label="거래처 방 연결"
          hint="연결된 방이 0개면 봇이 모든 방을 걸러내 아무것도 수집되지 않습니다"
        />
        {!ready ? (
          <div className="card-b" style={{ paddingTop: 14 }}>
            <div className="note warn" style={{ margin: 0 }}>
              아직 준비가 덜 됐습니다. 위 항목을 모두 채워야 수집이 시작됩니다.
            </div>
          </div>
        ) : null}
      </div>

      {/* 단말 설치 */}
      <div className="card">
        <div className="card-h">
          <div>
            <h2>단말 설치</h2>
            <div className="desc">업무 전용 안드로이드 단말의 메신저봇R 이 거래처 방 메시지를 여기로 보냅니다.</div>
          </div>
        </div>
        <div className="card-b">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9, color: 'var(--g600)' }}>
            <li>
              업무 전용 안드로이드 단말에 Play스토어에서 <b>메신저봇R</b> 설치
            </li>
            <li>
              권한 허용 — <b>알림 접근</b>(수신), <b>배터리 최적화 해제</b>(상시 실행)
            </li>
            <li>
              봇 새로 만들기 → 저장소의 <code>bot/speciai-bot.js</code> 내용을 전부 붙여넣기
            </li>
            <li>
              스크립트 상단 <code>ENDPOINT</code>·<code>TOKEN</code> 값 채우기 (아래 참고)
            </li>
            <li>
              <b>컴파일 ON</b> → 봇 계정으로 거래처 단톡방에 초대
            </li>
          </ol>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CopyField label="ENDPOINT" value={`${status.appUrl}/api/kakao/bot/ingest`} />
            <CopyField label="RULES_ENDPOINT" value={`${status.appUrl}/api/kakao/bot/rules`} />
            <div>
              <div className="tiny" style={{ fontWeight: 700, marginBottom: 6 }}>
                TOKEN
              </div>
              <div className="note" style={{ margin: 0 }}>
                서버 환경변수 <code>KAKAO_INGEST_TOKEN</code> 과 같은 값을 넣습니다. 보안상 이 화면에는
                표시하지 않습니다 — 배포 환경변수에서 직접 복사하세요.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 방 이름을 넣으면 어떤 규칙에 걸리는지 보여준다. 서버와 같은 순수 매칭 함수를 그대로 쓴다. */
function MatchTester({ partners }: { partners: PartnerRow[] }) {
  const [name, setName] = useState('');

  // #등록 이 만든 exact 규칙 + 예전 패턴 규칙을 서버와 같은 모양으로 합친다.
  const rules = useMemo<RoomRule[]>(() => {
    const out: RoomRule[] = [];
    for (const p of partners) {
      for (const r of p.rooms) {
        out.push({
          id: r.ruleId,
          partnerId: p.id,
          kind: 'exact',
          pattern: r.roomName,
          priority: BIND_PRIORITY,
          partnerName: p.name,
        });
      }
      for (const r of p.legacyRules) {
        out.push({
          id: r.id,
          partnerId: p.id,
          kind: r.kind,
          pattern: r.pattern,
          priority: r.priority,
          partnerName: p.name,
        });
      }
    }
    return out;
  }, [partners]);

  const hit = name.trim() ? matchRoomRule(name, rules) : null;

  return (
    <div className="card">
      <div className="card-h">
        <div>
          <h2>매칭 확인</h2>
          <div className="desc">방 이름을 넣으면 어떤 규칙에 걸리는지 보여줍니다.</div>
        </div>
      </div>
      <div className="test">
        <label htmlFor="tname">방 이름</label>
        <input
          className="input"
          id="tname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 대성정밀 3공장 자재"
        />
        {name.trim() ? (
          <div className="result">
            <div className="rline">
              <span className="rk">정리된 이름</span>
              <span className="rv">{normalizeRoomName(name)}</span>
            </div>
            {hit ? (
              <>
                <div className="rline">
                  <span className="rk">걸린 규칙</span>
                  <span className="rv">
                    <span className="tag point">{KIND_LABELS[hit.kind]}</span>
                  </span>
                </div>
                <div className="rline">
                  <span className="rk">패턴</span>
                  <span className="rv" title={hit.pattern}>
                    {hit.pattern}
                  </span>
                </div>
                <div className="rline">
                  <span className="rk">우선순위</span>
                  <span className="rv">{hit.priority}</span>
                </div>
                <div className="rline">
                  <span className="rk">연결될 거래처</span>
                  <span className="rv">{hit.partnerName ?? '—'}</span>
                </div>
              </>
            ) : (
              <div className="rline">
                <span className="rk">결과</span>
                <span className="rv" style={{ color: 'var(--amber)' }}>
                  어느 규칙에도 걸리지 않음 — 이 이름의 방은 저장되지 않습니다
                </span>
              </div>
            )}
          </div>
        ) : null}
        <div className="tiny muted" style={{ marginTop: 14 }}>
          연결은 카톡방 안에서 <b>#등록 회사명</b> 으로 만드는 것이 기본입니다. 여기는 확인용입니다.
        </div>
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
    <div className="ur">
      <div className="un">
        <b>{room.roomName}</b>
        <span>
          {room.hitCount}번 받음 · 최근 {seoulMonthDayTime(room.lastSeenAt)}
        </span>
      </div>
      <div className="ua">
        {canEdit ? (
          <>
            <select
              className="input"
              style={{ height: 38, borderRadius: 10, fontSize: 13.5 }}
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
              className="btn sm primary"
              disabled={pending || !partnerId}
              onClick={() => onAdopt(partnerId)}
            >
              거래처 연결
            </button>
          </>
        ) : null}
        <button type="button" className="btn sm" disabled={pending} onClick={onDismiss}>
          무시
        </button>
      </div>
    </div>
  );
}

function StatusLine({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="statusline">
      <span className={`si ${ok ? 'ok' : 'wait'}`}>{ok ? '✓' : '·'}</span>
      <span className="sb">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      <span className={`tag ${ok ? 'green' : 'amber'}`}>{ok ? '완료' : '필요'}</span>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="tiny" style={{ fontWeight: 700, marginBottom: 6 }}>
        {label}
      </div>
      <div className="copyrow">
        <input className="input" readOnly value={value} />
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
    </div>
  );
}
