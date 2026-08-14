import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { OnboardingClient } from '@/components/OnboardingClient';
import { createWorkspace } from '@/server/actions/workspace';
import { getServerClient } from '@/lib/db';

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
