import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { acceptInvite } from '@/server/actions/members';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `워크스페이스 초대 · ${BRAND.name}` };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect('/');

  const session = await getSession(await cookies());
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent(`/auth/invite?token=${token}`)}`);

  const result = await acceptInvite(token);

  return (
    <div className="tsa auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">율</div>
          <div>
            <div className="auth-title">워크스페이스 초대</div>
            <div className="auth-sub">{session.email}</div>
          </div>
        </div>
        {result.error ? (
          <>
            <div className="auth-error">{result.error}</div>
            <a className="btn btn-secondary auth-submit" href="/" style={{ marginTop: 16, textAlign: 'center' }}>
              메인으로
            </a>
          </>
        ) : (
          <>
            <div className="auth-sent-title">초대를 수락했습니다</div>
            <div className="auth-sent-text">이제 워크스페이스에 접근할 수 있습니다.</div>
            <a className="btn btn-dark auth-submit" href="/" style={{ textAlign: 'center' }}>
              시작하기
            </a>
          </>
        )}
      </div>
    </div>
  );
}
