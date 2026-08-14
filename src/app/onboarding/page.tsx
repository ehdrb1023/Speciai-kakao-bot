import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { OnboardingClient } from '@/components/OnboardingClient';
import { createWorkspace } from '@/server/actions/workspace';
import { signOut } from '@/server/actions/auth';
import { getServerClient } from '@/lib/db';
import { BRAND } from '@/lib/brand';

export const metadata = { title: '워크스페이스 만들기' };

export default async function Page() {
  const session = await getSession(await cookies());
  if (!session) redirect('/auth/sign-in');
  if (session.workspaceId) redirect('/');

  // 초대받은 사람은 워크스페이스를 만들 게 아니라 초대를 수락해야 한다.
  //
  // 이메일 가입은 콜백 라우트를 안 거치고 바로 세션이 생겨서(메일 확인 꺼짐) 여기로 온다.
  // 이 화면에서 "만들기" 를 누르는 순간 팀원은 **텅 빈 자기 워크스페이스**의 주인이 되고,
  // 정작 초대는 그대로 남아 "왜 아무것도 안 보이냐" 가 된다. 실제로 그렇게 됐다(2026-08-13).
  //
  // 아직 아무 워크스페이스의 멤버가 아니라 invitations 의 RLS 에 걸린다. 조회만 service-role
  // 로 하고, 실제 수락은 acceptInvite 가 이메일을 대조한 뒤 한다.
  const email = session.email.trim().toLowerCase();
  if (email) {
    const { data: pending } = await getServerClient()
      .from('invitations')
      .select('token')
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending?.token) {
      redirect(`/auth/invite?token=${encodeURIComponent(pending.token as string)}`);
    }
  }

  // 워크스페이스가 이미 있으면 만들기 화면을 아예 보여주지 않는다.
  //
  // 초대장 유무로만 걸렀더니, 승인제로 바꾼 뒤(29bcd0f) 대기자에게는 초대장이 없어 그대로
  // 만들기 버튼을 보게 됐다. 누른 계정은 자기 소유의 빈 워크스페이스로 들어가고 사내
  // 데이터가 둘로 갈라진다. 버튼을 없애는 것이 안내문을 고치는 것보다 확실하다.
  // (서버 액션 createWorkspace 도 같은 조건으로 한 번 더 막는다 — 화면은 우회될 수 있다.)
  const anchored = !!process.env.KAKAO_WORKSPACE_ID?.trim();
  let exists = anchored;
  if (!exists) {
    const { count, error } = await getServerClient()
      .from('workspaces')
      .select('id', { count: 'exact', head: true });
    exists = !!error || (count ?? 0) > 0; // 세지 못했으면 만들지 않는다(fail-closed)
  }

  if (exists) {
    return (
      <div className="tsa auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">{BRAND.mark}</div>
            <div>
              <div className="auth-title">승인 대기 중</div>
              <div className="auth-sub">
                {session.displayName ?? email} ({email})
              </div>
            </div>
          </div>
          <p className="auth-note">
            가입은 끝났습니다. 관리자가 <b>멤버 관리 → 가입 대기</b>에서 권한을 주면 바로
            콘솔이 열립니다. 이 화면을 새로고침해 확인하세요.
          </p>
          <p className="auth-note">
            워크스페이스는 사내에 하나뿐이라 직접 만들 수 없습니다. 거래처 대화가 갈라져
            쌓이는 것을 막기 위한 제한입니다.
          </p>
          <form action={signOut}>
            <button type="submit" className="btn auth-submit">
              로그아웃
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tsa auth-shell">
      <OnboardingClient
        createAction={createWorkspace}
        userEmail={session.email}
        userName={session.displayName ?? session.email.split('@')[0] ?? ''}
      />
    </div>
  );
}
