'use client';

// 거래처 — 여기서는 회사명만 관리한다.
//
// 방↔거래처 연결은 카톡방 안에서 "#등록 <회사명>" 으로 만든다. 이 화면에서 방 이름 패턴을
// 손으로 맞추게 하지 않는 이유: 대괄호 하나 빠진 규칙이 섞이면 그 방은 아무 소리 없이
// 수집되지 않고, 몇 주 뒤에야 "왜 이 방만 안 들어오지" 로 발견된다.

import { useState, useTransition } from 'react';
import { Ic } from '../IconDefs';
import { EmptyState } from '../EmptyState';
import type { PartnerRow, RuleRow, BoundRoomRow } from '@/server/actions/partners';
import type { RoomRuleKind } from '@/server/kakao/rules';

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

  function run(fn: () => Promise<{ error?: string }>, okMsg: string) {
    start(async () => {
      const res = await fn();
      setMsg(res.error ? `실패: ${res.error}` : okMsg);
    });
  }

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
      {unmatched.length > 0 ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sh" style={{ marginBottom: 10 }}>
            <Ic id="i-flag" w={15} />
            <b>연결 안 된 방 {unmatched.length}개</b>
          </div>
          <div className="fhint" style={{ marginBottom: 10 }}>
            봇이 본 적 있지만 어느 거래처에도 안 붙은 방입니다. 없는 회사명으로 <b>#등록</b> 을 친 방도
            여기 나옵니다. 본문은 저장하지 않았습니다 — 연결해도 지난 대화는 되살아나지 않고, 그 이후
            메시지부터 쌓입니다.
          </div>
          <div className="list">
            {unmatched.map((u) => (
              <UnmatchedRow
                key={u.id}
                room={u}
                partners={partners}
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
                }, '거래처를 추가했어요. 이제 카톡방에서 #등록 으로 방을 붙이세요.')
              }
            >
              추가
            </button>
          </div>
          <div className="fhint">
            여기 적은 이름 그대로 방에서 쳐야 합니다. <b>삼성전자</b> 로 등록했으면 방에서는{' '}
            <b>#등록 삼성전자</b> 입니다.
          </div>
        </div>
      ) : null}

      {/* 거래처 목록 */}
      {partners.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="i-bldg"
            title="등록된 거래처가 없어요"
            desc="회사명을 먼저 추가하세요. 그 다음 카톡방에서 #등록 회사명 을 치면 그 방부터 수집됩니다."
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
          카톡에서 그 방의 <b>방 제목을 지정</b>합니다. 제목이 없으면 등록이 거부됩니다.
        </li>
        <li>
          그 방에서 <b>#등록 회사명</b> 을 한 번 칩니다. 끊을 때는 <b>#등록해제</b> 입니다.
        </li>
      </ol>
      <div className="fhint">
        봇이 설치된 폰의 주인이 직접 치면 안 됩니다 — 자기 발화는 알림에 뜨지 않아 봇이 못 봅니다.
        방의 다른 사람이 치거나, 위 &ldquo;연결 안 된 방&rdquo; 목록에서 붙이세요.
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
            <span key={r.ruleId} className="chipx wt">
              {r.roomName}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${r.roomName} 연결 해제`}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`"${r.roomName}" 방의 수집을 멈출까요? 모아둔 대화는 남습니다.`)) {
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
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '');

  return (
    <div className="rowc" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span className="cav">
        <Ic id="i-bubble" w={16} />
      </span>
      <span className="cm">
        <b>{room.roomName}</b>
        <span className="mt">
          {room.hitCount}회 수신 · 마지막{' '}
          {new Date(room.lastSeenAt).toLocaleString('ko-KR', {
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
