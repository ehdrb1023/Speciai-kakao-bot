'use client';

// 거래처 — 방 이름 규칙 등록이 이 앱의 핵심 설정 화면이다.
// 여기서 등록한 규칙이 봇 단말로 내려가 개인 카톡을 걸러내고, 서버에서 거래처 매칭에 쓰인다.

import { useState, useTransition } from 'react';
import { Ic } from '../IconDefs';
import { EmptyState } from '../EmptyState';
import type { PartnerRow, RuleRow } from '@/server/actions/partners';
import type { RoomRuleKind } from '@/server/kakao/rules';

export interface UnmatchedRoom {
  id: string;
  roomName: string;
  hitCount: number;
  lastSeenAt: string;
}

export interface PartnersActions {
  createPartner: (input: { name: string; pattern?: string; kind?: RoomRuleKind }) => Promise<{ error?: string }>;
  deletePartner: (id: string) => Promise<{ error?: string }>;
  upsertRule: (input: {
    id?: string;
    partnerId: string;
    kind: RoomRuleKind;
    pattern: string;
  }) => Promise<{ error?: string }>;
  deleteRule: (id: string) => Promise<{ error?: string }>;
  adoptUnmatchedRoom: (input: {
    unmatchedId: string;
    partnerId: string;
    kind: RoomRuleKind;
    pattern: string;
  }) => Promise<{ error?: string }>;
  dismissUnmatchedRoom: (id: string) => Promise<{ error?: string }>;
  testRoomName: (roomName: string) => Promise<{
    matchedPartner: string | null;
    candidates: { partner: string; kind: RoomRuleKind; pattern: string }[];
  }>;
}

const KIND_LABELS: Record<RoomRuleKind, string> = {
  prefix: '접두어',
  exact: '완전일치',
  contains: '포함',
  regex: '정규식',
};

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
  const [newPattern, setNewPattern] = useState('');

  function run(fn: () => Promise<{ error?: string }>, okMsg: string) {
    start(async () => {
      const res = await fn();
      setMsg(res.error ? `실패: ${res.error}` : okMsg);
    });
  }

  // 거래처명을 치면 접두어를 "[이름]" 으로 자동 제안한다. 우리 방 이름 관행이 그 형태라서,
  // 매번 대괄호를 직접 치게 하면 대괄호 빠뜨린 규칙이 섞인다.
  function onNameChange(value: string) {
    const suggested = `[${newName.trim()}]`;
    setNewName(value);
    if (!newPattern || newPattern === suggested) {
      setNewPattern(value.trim() ? `[${value.trim()}]` : '');
    }
  }

  return (
    <>
      <div className="vhead">
        <h1>거래처</h1>
        <div className="sub">
          방 이름 규칙을 등록하면 그 방만 수집합니다. 규칙에 없는 방은 봇 단말에서 걸러져 서버로 오지 않습니다.
        </div>
      </div>

      {msg ? (
        <div className="noterow" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      ) : null}

      {/* 규칙 시험 — 등록 전에 오타를 잡는다 */}
      <RuleTester testRoomName={actions.testRoomName} />

      {/* 미분류 방 — 규칙 누락을 눈으로 잡는 자리 */}
      {unmatched.length > 0 ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sh" style={{ marginBottom: 10 }}>
            <Ic id="i-flag" w={15} />
            <b>미분류 방 {unmatched.length}개</b>
          </div>
          <div className="fhint" style={{ marginBottom: 10 }}>
            봇이 본 적 있지만 규칙에 안 걸린 방입니다. 본문은 저장하지 않았습니다 — 규칙을 등록해도 지난
            대화는 되살아나지 않고, 등록 이후 메시지부터 쌓입니다.
          </div>
          <div className="list">
            {unmatched.map((u) => (
              <UnmatchedRow
                key={u.id}
                room={u}
                partners={partners}
                canEdit={canEdit}
                pending={pending}
                onAdopt={(partnerId, pattern) =>
                  run(
                    () =>
                      actions.adoptUnmatchedRoom({
                        unmatchedId: u.id,
                        partnerId,
                        kind: 'prefix',
                        pattern,
                      }),
                    '규칙을 등록했어요. 다음 메시지부터 이 거래처로 모입니다.',
                  )
                }
                onDismiss={() => run(() => actions.dismissUnmatchedRoom(u.id), '목록에서 내렸어요.')}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 거래처 추가 */}
      {canEdit ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sh" style={{ marginBottom: 10 }}>
            <Ic id="i-plus" w={15} />
            <b>거래처 추가</b>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="fld" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label htmlFor="p-name">거래처명</label>
              <input
                id="p-name"
                className="tin"
                value={newName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="삼성전자"
              />
            </div>
            <div className="fld" style={{ flex: '1 1 220px', marginBottom: 0 }}>
              <label htmlFor="p-pattern">방 이름 접두어</label>
              <input
                id="p-pattern"
                className="tin"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="[삼성전자]"
              />
            </div>
            <button
              type="button"
              className="btn pri"
              disabled={pending || !newName.trim()}
              onClick={() =>
                run(async () => {
                  const res = await actions.createPartner({
                    name: newName,
                    pattern: newPattern || undefined,
                    kind: 'prefix',
                  });
                  if (!res.error) {
                    setNewName('');
                    setNewPattern('');
                  }
                  return res;
                }, '거래처를 추가했어요.')
              }
            >
              추가
            </button>
          </div>
          <div className="fhint">
            방 이름이 <b>[삼성전자] 3분기 발주</b> 처럼 시작한다면 접두어는 <b>[삼성전자]</b> 입니다.
            뒷부분이 바뀌어도 계속 같은 거래처로 붙습니다.
          </div>
        </div>
      ) : null}

      {/* 거래처 목록 */}
      {partners.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="i-bldg"
            title="등록된 거래처가 없어요"
            desc="거래처를 추가하고 방 이름 접두어를 등록하면 그 방부터 수집이 시작됩니다."
          />
        </div>
      ) : (
        <div className="list">
          {partners.map((p) => (
            <PartnerCard
              key={p.id}
              partner={p}
              canEdit={canEdit}
              pending={pending}
              onAddRule={(kind, pattern) =>
                run(() => actions.upsertRule({ partnerId: p.id, kind, pattern }), '규칙을 추가했어요.')
              }
              onDeleteRule={(ruleId) => run(() => actions.deleteRule(ruleId), '규칙을 지웠어요.')}
              onDelete={() => run(() => actions.deletePartner(p.id), '거래처를 지웠어요.')}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PartnerCard({
  partner,
  canEdit,
  pending,
  onAddRule,
  onDeleteRule,
  onDelete,
}: {
  partner: PartnerRow;
  canEdit: boolean;
  pending: boolean;
  onAddRule: (kind: RoomRuleKind, pattern: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<RoomRuleKind>('prefix');
  const [pattern, setPattern] = useState('');

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="cav">{partner.name.charAt(0)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14, fontWeight: 800 }}>{partner.name}</b>
          <div className="pl-v" style={{ fontSize: 11.5, color: 'var(--mut)' }}>
            규칙 {partner.rules.length}개 · 방 {partner.roomCount}개
          </div>
        </div>
        {canEdit ? (
          <>
            <button type="button" className="chipx gy" disabled={pending} onClick={() => setAdding((v) => !v)}>
              <Ic id="i-plus" w={11} />
              규칙 추가
            </button>
            <button
              type="button"
              className="chipx rd"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`"${partner.name}" 거래처를 지울까요? 규칙도 함께 지워집니다. 모아둔 대화는 남습니다.`)) {
                  onDelete();
                }
              }}
            >
              삭제
            </button>
          </>
        ) : null}
      </div>

      {partner.rules.length === 0 ? (
        <div className="fhint" style={{ color: '#C2410C' }}>
          규칙이 없어 아무 방도 붙지 않습니다. 규칙을 하나 이상 등록하세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {partner.rules.map((r: RuleRow) => (
            <span key={r.id} className="chipx wt">
              {KIND_LABELS[r.kind]} · {r.pattern}
              {canEdit ? (
                <button
                  type="button"
                  aria-label="규칙 삭제"
                  disabled={pending}
                  onClick={() => onDeleteRule(r.id)}
                  style={{ marginLeft: 4, color: 'var(--fnt)', fontWeight: 800 }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {adding && canEdit ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="fld" style={{ flex: '0 0 120px', marginBottom: 0 }}>
            <label htmlFor={`k-${partner.id}`}>종류</label>
            <select
              id={`k-${partner.id}`}
              className="tin"
              value={kind}
              onChange={(e) => setKind(e.target.value as RoomRuleKind)}
            >
              {(Object.keys(KIND_LABELS) as RoomRuleKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="fld" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label htmlFor={`p-${partner.id}`}>패턴</label>
            <input
              id={`p-${partner.id}`}
              className="tin"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={`[${partner.name}]`}
            />
          </div>
          <button
            type="button"
            className="btn pri sm"
            disabled={pending || !pattern.trim()}
            onClick={() => {
              onAddRule(kind, pattern);
              setPattern('');
              setAdding(false);
            }}
          >
            등록
          </button>
        </div>
      ) : null}
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
  onAdopt: (partnerId: string, pattern: string) => void;
  onDismiss: () => void;
}) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '');
  // 방 이름 앞의 "[...]" 를 접두어 후보로 뽑는다. 우리 방 이름 관행이 그 형태라 대개 이게 정답이다.
  const suggested = room.roomName.match(/^\[[^\]]+\]/)?.[0] ?? room.roomName;
  const [pattern, setPattern] = useState(suggested);

  return (
    <div className="rowc" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span className="cav">
        <Ic id="i-bubble" w={16} />
      </span>
      <span className="cm">
        <b>{room.roomName}</b>
        <span className="mt">
          {room.hitCount}회 수신 · 마지막 {new Date(room.lastSeenAt).toLocaleString('ko-KR', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </span>
      {canEdit ? (
        <>
          <select
            className="tin"
            style={{ flex: '0 0 140px' }}
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
          <input
            className="tin"
            style={{ flex: '0 0 160px' }}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            aria-label="접두어"
          />
          <button
            type="button"
            className="btn pri sm"
            disabled={pending || !partnerId || !pattern.trim()}
            onClick={() => onAdopt(partnerId, pattern)}
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

/** 방 이름을 넣어 어느 거래처로 붙는지 미리 본다. 접두어 오타를 등록 전에 잡는 용도. */
function RuleTester({
  testRoomName,
}: {
  testRoomName: PartnersActions['testRoomName'];
}) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<PartnersActions['testRoomName']>> | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="sh" style={{ marginBottom: 10 }}>
        <Ic id="i-search" w={15} />
        <b>규칙 시험</b>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="tin"
          style={{ flex: '1 1 240px' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="[삼성전자] 3분기 발주"
          aria-label="시험할 방 이름"
        />
        <button
          type="button"
          className="btn gho"
          disabled={pending || !name.trim()}
          onClick={() => start(async () => setResult(await testRoomName(name)))}
        >
          확인
        </button>
      </div>
      {result ? (
        <div className="fnote" style={{ marginTop: 10 }}>
          <Ic id={result.matchedPartner ? 'i-check' : 'i-flag'} w={13} />
          {result.matchedPartner ? (
            <span>
              <b>{result.matchedPartner}</b> 로 수집됩니다.
              {result.candidates.length > 1
                ? ` (겹치는 규칙 ${result.candidates.length}개 — 더 구체적인 쪽이 이깁니다)`
                : ''}
            </span>
          ) : (
            <span>걸리는 규칙이 없습니다. 이 방은 수집되지 않습니다.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
