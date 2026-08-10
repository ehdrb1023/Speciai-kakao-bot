import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/server';
import { OnboardingClient } from '@/components/OnboardingClient';
import { createWorkspace } from '@/server/actions/workspace';

export const metadata = { title: '워크스페이스 만들기' };

export default async function Page() {
  const session = await getSession(await cookies());
  if (!session) redirect('/auth/sign-in');
  if (session.workspaceId) redirect('/');

  return (
    <div className="auth-shell">
      <OnboardingClient
        createAction={createWorkspace}
        userEmail={session.email}
        userName={session.displayName ?? session.email.split('@')[0] ?? ''}
      />
    </div>
  );
}
