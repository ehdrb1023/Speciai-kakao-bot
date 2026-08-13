import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getSession, createSupabaseServerClient } from '@/lib/auth/server';
import { canManageMembers } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { MembersPanel, type MemberRow, type InvitationRow } from '@/lib/ui';
import { listRooms, listRoomMessages, listRoomOutbound, listUnmatchedRooms } from '@/server/kakao';
import { ConsoleShell } from '@/components/console/ConsoleShell';
import { InboxView, type InboxViewData } from '@/components/console/views/InboxView';
import {
  listPartners,
  createPartner,
  deletePartner,
  linkRoom,
  unlinkRoom,
  adoptUnmatchedRoom,
  dismissUnmatchedRoom,
} from '@/server/actions/partners';
import {
  invite,
  changeRole,
  removeMember,
  cancelInvite,
  listPendingAccounts,
  grantAccess,
} from '@/server/actions/members';
import { saveStaffAliases, saveDisplayName } from '@/server/actions/workspace';
import { signOut } from '@/server/actions/auth';

// 받은 카톡만 static(기본 탭). 나머지는 탭별 코드분할 — 초기 청크에서 분리한다.
const PartnersView = dynamic(() =>
  import('@/components/console/views/PartnersView').then((m) => m.PartnersView),
);
const LinkView = dynamic(() => import('@/components/console/views/LinkView').then((m) => m.LinkView));
const StaffAliasesPanel = dynamic(() =>
  import('@/components/StaffAliasesPanel').then((m) => m.StaffAliasesPanel),
);
const DisplayNamePanel = dynamic(() =>
  import('@/components/DisplayNamePanel').then((m) => m.DisplayNamePanel),
);

export default async function Page() {
  // layout 과 같은 폴백 — layout·page 는 병렬 렌더라 여기에도 있어야 확실히 미리보기로 간다.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== 'production') {
    redirect('/preview');
  }
  const session = await getSession(await cookies());
  if (!session) redirect('/auth/sign-in');
  if (!session.workspaceId) redirect('/onboarding');
  const workspaceId = session.workspaceId;

  const cookieStore = await cookies();
  const sb = createSupabaseServerClient(cookieStore);
  const canEdit = canManageMembers(session.role);

  // 서로 의존성 없는 항목을 단일 Promise.all 로 병렬 로드.
  const [{ data: ws }, rooms, unmatched, partners, messageCountRes, memberRes, inviteRes] =
    await Promise.all([
      sb.from('workspaces').select('name, staff_aliases').eq('id', workspaceId).single(),
      listRooms(sb, workspaceId),
      listUnmatchedRooms(sb, workspaceId),
      listPartners(),
      sb
        .from('kakao_messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      sb
        .from('memberships')
        .select('user_id, role, joined_at, profiles:profiles!memberships_user_id_fkey(email, display_name)')
        .eq('workspace_id', workspaceId)
        .order('joined_at', { ascending: true }),
      sb
        .from('invitations')
        .select('id, email, role, expires_at, created_at')
        .eq('workspace_id', workspaceId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ]);

  // 첫 방의 대화만 미리 싣는다. 나머지는 클릭 시 /api/kakao/thread 로 지연 로드.
  const messagesByRoom: InboxViewData['messagesByRoom'] = {};
  const outboundByRoom: InboxViewData['outboundByRoom'] = {};
  const firstRoom = rooms[0];
  if (firstRoom) {
    const [msgs, out] = await Promise.all([
      listRoomMessages(sb, workspaceId, firstRoom.id),
      listRoomOutbound(sb, workspaceId, firstRoom.id),
    ]);
    messagesByRoom[firstRoom.id] = msgs;
    outboundByRoom[firstRoom.id] = out;
  }

  const staffAliases = Array.isArray(ws?.staff_aliases)
    ? (ws.staff_aliases as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const inboxData: InboxViewData = {
    rooms: rooms.map((r) => ({
      id: r.id,
      roomName: r.roomName,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      color: r.color,
      pinned: r.pinned,
      handled: r.handled,
      lastMessageAt: r.lastMessageAt,
      preview: r.preview,
      messageCount: r.messageCount,
    })),
    messagesByRoom,
    outboundByRoom,
    staffLabel: BRAND.staffLabel,
    // viewer 는 열람 전용. 서버 라우트에서도 같은 판정을 하므로 여기 값은 화면 표시용이다.
    canSend: session.role !== 'viewer',
    unmatchedCount: unmatched.length,
  };

  // 가입은 했지만 아직 이 워크스페이스에 못 들어온 계정. 관리자에게만 의미가 있어 여기서만 부른다.
  const pendingAccounts = canEdit ? await listPendingAccounts() : [];

  const linkedRoomCount = partners.reduce((sum, p) => sum + p.rooms.length, 0);
  const unhandled = rooms.filter((r) => !r.handled).length;

  const roleLabel =
    session.role === 'owner' ? '대표 · 소유자' : session.role === 'admin' ? '관리자' : '열람';

  const members: MemberRow[] = (memberRes.data ?? []).map((m: any) => ({
    userId: m.user_id,
    email: m.profiles?.email ?? '',
    displayName: m.profiles?.display_name ?? null,
    role: m.role,
    joinedAt: m.joined_at,
    isSelf: m.user_id === session.userId,
  }));
  const invitations: InvitationRow[] = (inviteRes.data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }));

  return (
    <ConsoleShell
      brandName={BRAND.name}
      brandMark={BRAND.mark}
      brandSub={ws?.name ?? '업무 콘솔'}
      userName={session.displayName ?? session.email}
      userRole={roleLabel}
      badges={{ kakao: unhandled }}
      isAdmin={canEdit}
      signOutAction={signOut}
      slots={{
        kakao: <InboxView data={inboxData} />,
        partners: (
          <PartnersView
            partners={partners}
            unmatched={unmatched.map((u) => ({
              id: u.id,
              roomName: u.roomName,
              hitCount: u.hitCount,
              lastSeenAt: u.lastSeenAt,
            }))}
            canEdit={canEdit}
            actions={{
              createPartner,
              deletePartner,
              linkRoom,
              unlinkRoom,
              adoptUnmatchedRoom,
              dismissUnmatchedRoom,
            }}
          />
        ),
        link: (
          <LinkView
            status={{
              // 토큰 실제 값은 클라이언트로 내리지 않는다. 설정 여부만 전달.
              ingestTokenConfigured: !!process.env.KAKAO_INGEST_TOKEN,
              // 값이 있는지가 아니라 **지금 보고 있는 이 워크스페이스를 가리키는지**를 본다.
              // 값만 확인하던 시절, 지워진 워크스페이스의 ID 가 남아 있는데도 "완료" 로 떠서
              // 봇이 올린 것이 전부 유령 워크스페이스로 갔다(2026-08-12). 화면이 거짓말을 하면
              // 원인을 엉뚱한 데서 찾게 된다 — 그게 제일 비싼 실패다.
              workspaceIdConfigured:
                !process.env.KAKAO_WORKSPACE_ID ||
                process.env.KAKAO_WORKSPACE_ID.trim() === session.workspaceId,
              workspaceIdMismatch:
                !!process.env.KAKAO_WORKSPACE_ID &&
                process.env.KAKAO_WORKSPACE_ID.trim() !== session.workspaceId,
              expectedWorkspaceId: session.workspaceId,
              appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
              linkedRoomCount,
              roomCount: rooms.length,
              messageCount: messageCountRes.count ?? 0,
              lastIngestAt: rooms[0]?.lastMessageAt ?? null,
            }}
          />
        ),
        settings: (
          <>
            <DisplayNamePanel
              current={session.displayName ?? session.email.split('@')[0] ?? ''}
              saveAction={saveDisplayName}
            />
            <StaffAliasesPanel
              aliases={staffAliases}
              canEdit={canEdit}
              saveAction={saveStaffAliases}
            />
            <MembersPanel
              workspaceName={ws?.name ?? '워크스페이스'}
              canManage={canEdit}
              members={members}
              invitations={invitations}
              inviteAction={invite}
              changeRoleAction={changeRole}
              removeMemberAction={removeMember}
              cancelInviteAction={cancelInvite}
              pendingAccounts={pendingAccounts}
              grantAccessAction={grantAccess}
            />
          </>
        ),
      }}
    />
  );
}
