'use client';

// 봇 연동 — 단말 설치 안내와 현재 연동 상태.
// 토큰 실제 값은 절대 내려보내지 않는다. 설정 여부(boolean)만 받아 표시한다.

import { useState } from 'react';
import { Ic } from '../IconDefs';
import { seoulFull } from '@/lib/time';

export interface LinkStatus {
  ingestTokenConfigured: boolean;
  workspaceIdConfigured: boolean;
  appUrl: string;
  /** "#등록" 으로 거래처에 붙은 방 수. 0 이면 봇이 모든 방을 걸러낸다. */
  linkedRoomCount: number;
  roomCount: number;
  messageCount: number;
  lastIngestAt: string | null;
}

export function LinkView({ status }: { status: LinkStatus }) {
  const ready = status.ingestTokenConfigured && status.workspaceIdConfigured && status.linkedRoomCount > 0;

  return (
    <>
      <div className="vhead">
        <h1>봇 연동</h1>
        <div className="sub">전용 안드로이드 단말의 메신저봇R 이 거래처 방 메시지를 여기로 보냅니다.</div>
      </div>

      <div className="srail">
        <div className="smini">
          수집된 방<b>{status.roomCount}</b>
        </div>
        <div className="smini">
          메시지<b>{status.messageCount}</b>
        </div>
        <div className="smini">
          연결된 방<b>{status.linkedRoomCount}</b>
        </div>
        <div className="smini">
          마지막 수신<b>{status.lastIngestAt ? seoulFull(status.lastIngestAt) : '없음'}</b>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sh" style={{ marginBottom: 12 }}>
          <Ic id="i-shield" w={15} />
          <b>연동 상태</b>
        </div>
        <div className="list">
          <StatusLine ok={status.ingestTokenConfigured} label="KAKAO_INGEST_TOKEN 설정" hint="봇과 서버가 공유하는 머신 토큰" />
          <StatusLine
            ok={status.workspaceIdConfigured}
            label="KAKAO_WORKSPACE_ID 설정"
            hint="봇이 보낸 메시지를 어느 워크스페이스에 쌓을지"
          />
          <StatusLine
            ok={status.linkedRoomCount > 0}
            label="거래처 방 연결"
            hint="연결된 방이 0개면 봇이 모든 방을 걸러내 아무것도 수집되지 않습니다"
          />
        </div>
        {!ready ? (
          <div className="fnote" style={{ marginTop: 12 }}>
            <Ic id="i-flag" w={13} />
            아직 준비가 덜 됐습니다. 위 항목을 모두 채워야 수집이 시작됩니다.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sh" style={{ marginBottom: 12 }}>
          <Ic id="i-bot" w={15} />
          <b>단말 설치</b>
        </div>
        <ol style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: 'var(--ink2)', fontWeight: 600 }}>
          <li>업무 전용 안드로이드 단말에 Play스토어에서 <b>메신저봇R</b> 설치</li>
          <li>권한 허용 — <b>알림 접근</b>(수신), <b>배터리 최적화 해제</b>(상시 실행)</li>
          <li>봇 새로 만들기 → 저장소의 <code>bot/speciai-bot.js</code> 내용을 전부 붙여넣기</li>
          <li>스크립트 상단 <code>ENDPOINT</code>·<code>TOKEN</code> 두 값 채우기 (아래 참고)</li>
          <li><b>컴파일 ON</b> → 봇 계정으로 거래처 단톡방에 초대</li>
        </ol>

        <div className="fld" style={{ marginTop: 12 }}>
          <label>ENDPOINT</label>
          <CopyField value={`${status.appUrl}/api/kakao/bot/ingest`} />
        </div>
        <div className="fld">
          <label>RULES_ENDPOINT</label>
          <CopyField value={`${status.appUrl}/api/kakao/bot/rules`} />
        </div>
        <div className="fld">
          <label>TOKEN</label>
          <div className="placeholder">
            서버 환경변수 <code>KAKAO_INGEST_TOKEN</code> 과 같은 값을 넣습니다. 보안상 이 화면에는 표시하지
            않습니다 — 배포 환경변수에서 직접 복사하세요.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="sh" style={{ marginBottom: 12 }}>
          <Ic id="i-lock" w={15} />
          <b>개인 카톡은 어떻게 걸러지나</b>
        </div>
        <div className="fhint" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          봇은 <b>연결된 방 목록</b>을 10분마다 서버에서 내려받아 단말에 보관합니다. 목록에
          없는 방(개인 카톡·가족방 등)은 <b>단말에서 차단되어 서버로 전송되지 않습니다.</b> 방을
          추가하면 다음 갱신 때 단말에 자동 반영되므로 단말을 다시 만질 필요가 없습니다.
          <br />
          <br />
          단말이 서버에 한 번도 연결되지 못했다면 목록이 비어 있어 <b>아무 방도 전송하지 않습니다</b>(모두
          전송하는 쪽이 아니라 아무것도 안 보내는 쪽으로 실패합니다).
        </div>
      </div>
    </>
  );
}

function StatusLine({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="cline">
      <span className={ok ? 'dot-ok' : 'dot-wait'}>
        <Ic id={ok ? 'i-check' : 'i-minus'} w={10} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{label}</b>
        <span className="sub2" style={{ display: 'block' }}>
          {hint}
        </span>
      </span>
      <span className={`chipx ${ok ? 'gr' : 'am'}`}>{ok ? '완료' : '필요'}</span>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input className="tin" readOnly value={value} style={{ flex: 1, minWidth: 0 }} />
      <button
        type="button"
        className="btn gho sm"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Ic id="i-copy" w={13} />
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}
