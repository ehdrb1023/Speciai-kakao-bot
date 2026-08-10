import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth/server';

// (main) 공통 가드: 세션·워크스페이스 검증. 셸(탭 네비)은 루트 페이지가 렌더한다.
export default async function MainLayout({ children }: { children: ReactNode }) {
  // Supabase 미설정 상태에서 로그인 화면으로 보내면 거기서 더 갈 데가 없다.
  // 개발 중이라면 목업 UI 로 안내한다.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== 'production') {
    redirect('/preview');
  }
  const session = await getSession(await cookies());
  if (!session) redirect('/auth/sign-in');
  if (!session.workspaceId) redirect('/onboarding');
  return <>{children}</>;
}
