'use client';

// 미리보기 콘솔 — Supabase 없이 UI 만 확인한다.
//
// 클라이언트 컴포넌트로 둔 이유: 각 뷰가 서버 액션을 prop 으로 받는데, 서버 컴포넌트에서
// 평범한 함수를 클라이언트 경계 너머로 넘길 수 없다. 여기서 전부 클라이언트로 두면
// 로컬 no-op 함수를 그대로 넘길 수 있다.

import { useState } from 'react';
import { ConsoleShell, type HeroDef, type ViewKey } from '@/components/console/ConsoleShell';
import { InboxView } from '@/components/console/views/InboxView';
import { PartnersView } from '@/components/console/views/PartnersView';
import { LinkView } from '@/components/console/views/LinkView';
import { StaffAliasesPanel } from '@/components/StaffAliasesPanel';
import { MembersPanel } from '@/lib/ui';
import { BRAND } from '@/lib/brand';
import {
  PREVIEW_MEMBERS,
  PREVIEW_MESSAGES,
  PREVIEW_PARTNERS,
  PREVIEW_ROOMS,
  PREVIEW_STAFF_ALIASES,
  PREVIEW_UNMATCHED,
} from './fixtures';

// 미리보기에서는 어떤 변경도 저장되지 않는다. 저장 버튼이 조용히 아무것도 안 하면
// 고장으로 보이므로, 눌렀을 때 그 사실을 문구로 돌려준다.
const NOT_SAVED = { error: '미리보기 화면이라 저장되지 않아요' };
async function noop() {
  return NOT_SAVED;
}

export function PreviewConsole() {
  const [dismissed, setDismissed] = useState(false);

  const unhandled = PREVIEW_ROOMS.filter((r) => !r.handled).length;
  const linkedRoomCount = PREVIEW_PARTNERS.reduce((sum, p) => sum + p.rooms.length, 0);
  const messageCount = PREVIEW_ROOMS.reduce((sum, r) => sum + r.messageCount, 0);

  const hero: Record<ViewKey, HeroDef> = {
    kakao: {
      eyebrow: '받은 카톡',
      title: '들어온 거래처 대화',
      lead: '등록된 방만 수집합니다. 규칙에 없는 방은 이름과 받은 횟수만 남고 본문은 저장되지 않습니다.',
      stats: [
        { k: '미처리 방', v: String(unhandled), unit: '개', alert: true, live: 'unhandled' },
        { k: '수집된 방', v: String(PREVIEW_ROOMS.length), unit: '개' },
        { k: '전체 메시지', v: String(messageCount), unit: '건' },
        { k: '연결 안 된 방', v: String(PREVIEW_UNMATCHED.length), unit: '개' },
      ],
    },
    partners: {
      eyebrow: '거래처',
      title: `수집하고 있는 거래처 ${PREVIEW_PARTNERS.length}곳`,
      lead: '거래처를 먼저 등록해야 카톡방에서 #등록 명령을 쓸 수 있습니다.',
      stats: [
        { k: '등록 거래처', v: String(PREVIEW_PARTNERS.length), unit: '곳' },
        { k: '연결된 방', v: String(linkedRoomCount), unit: '개' },
        { k: '연결 안 된 방', v: String(PREVIEW_UNMATCHED.length), unit: '개', alert: true },
        { k: '전체 메시지', v: String(messageCount), unit: '건' },
      ],
    },
    link: {
      eyebrow: '연결 진단',
      title: `연결이 비어 있는 방 ${PREVIEW_UNMATCHED.length}개`,
      lead: '방이 어느 거래처에도 안 붙으면 대화가 쌓이지 않습니다.',
      stats: [
        { k: '연결 안 된 방', v: String(PREVIEW_UNMATCHED.length), unit: '개', alert: true },
        { k: '연결된 방', v: String(linkedRoomCount), unit: '개' },
        { k: '수집된 방', v: String(PREVIEW_ROOMS.length), unit: '개' },
        { k: '전체 메시지', v: String(messageCount), unit: '건' },
      ],
    },
    settings: {
      eyebrow: '설정',
      title: '워크스페이스 미리보기',
      lead: '발화자 인식과 발신 이름, 멤버 권한을 여기서 관리합니다.',
      stats: [
        { k: '멤버', v: String(PREVIEW_MEMBERS.length), unit: '명' },
        { k: '초대 대기', v: '0', unit: '명' },
        { k: '직원 닉네임', v: String(PREVIEW_STAFF_ALIASES.length), unit: '개' },
        { k: '등록 거래처', v: String(PREVIEW_PARTNERS.length), unit: '곳' },
      ],
    },
  };

  return (
    <>
      {!dismissed ? (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#26292F',
            color: '#fff',
            borderRadius: 12,
            padding: '10px 16px',
            fontSize: 12.5,
            fontWeight: 700,
            boxShadow: '0 12px 40px -12px rgba(0,0,0,.5)',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <span>미리보기 — 목업 데이터입니다. 저장·수집은 동작하지 않습니다.</span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{ color: 'rgba(255,255,255,.6)', fontWeight: 800, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <ConsoleShell
        brandName={BRAND.name}
        brandMark={BRAND.mark}
        brandSub="미리보기"
        userName="신동규"
        badges={{ kakao: unhandled, link: PREVIEW_UNMATCHED.length }}
        isAdmin
        hero={hero}
        // 미리보기는 세션이 없다. 로그아웃할 것도 없으니 아무것도 하지 않는다.
        signOutAction={async () => {}}
        slots={{
          kakao: (
            <InboxView
              data={{
                rooms: PREVIEW_ROOMS,
                messagesByRoom: PREVIEW_MESSAGES,
                outboundByRoom: {},
                staffLabel: BRAND.staffLabel,
                canSend: true,
                unmatchedCount: PREVIEW_UNMATCHED.length,
              }}
            />
          ),
          partners: (
            <PartnersView
              partners={PREVIEW_PARTNERS}
              canEdit
              actions={{
                createPartner: noop,
                deletePartner: noop,
                linkRoom: noop,
                unlinkRoom: noop,
              }}
            />
          ),
          link: (
            <LinkView
              partners={PREVIEW_PARTNERS}
              unmatched={PREVIEW_UNMATCHED}
              canEdit
              actions={{ adoptUnmatchedRoom: noop, dismissUnmatchedRoom: noop }}
              status={{
                ingestTokenConfigured: false,
                workspaceIdConfigured: false,
                currentWorkspaceId: '00000000-0000-0000-0000-000000000000',
                appUrl: typeof window === 'undefined' ? '' : window.location.origin,
                linkedRoomCount,
                roomCount: PREVIEW_ROOMS.length,
                messageCount,
                lastIngestAt: PREVIEW_ROOMS[0]?.lastMessageAt ?? null,
              }}
            />
          ),
          settings: (
            <div className="stack">
              <StaffAliasesPanel aliases={PREVIEW_STAFF_ALIASES} canEdit saveAction={noop} />
              <MembersPanel
                workspaceName="미리보기 워크스페이스"
                canManage
                members={PREVIEW_MEMBERS}
                invitations={[]}
                inviteAction={noop}
                changeRoleAction={noop}
                removeMemberAction={noop}
                cancelInviteAction={noop}
              />
            </div>
          ),
        }}
      />
    </>
  );
}
