import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cache } from 'react';

interface CookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete?(name: string): void;
}

/**
 * Next.js App Router의 cookies()를 주입하여 서버 컴포넌트·서버 액션용 Supabase 클라이언트 생성.
 *
 * 사용:
 *   import { cookies } from 'next/headers';
 *   const sb = createSupabaseServerClient(await cookies());
 */
export function createSupabaseServerClient(cookieStore: CookieStore) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        // @ts-expect-error — Next 15 cookies().getAll() shape
        return cookieStore.getAll?.() ?? [];
      },
      setAll(cookies: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          for (const c of cookies) {
            cookieStore.set(c.name, c.value, { ...c.options, path: '/' });
          }
        } catch {
          // 서버 컴포넌트에서 set 호출이 막힌 경우 무시. 미들웨어/액션에서 갱신.
        }
      },
    },
  });
}

export interface SessionContext {
  userId: string;
  email: string;
  displayName: string | null;
  workspaceId: string | null;
  role: 'owner' | 'admin' | 'viewer' | null;
}

async function _getSession(cookieStore: CookieStore): Promise<SessionContext | null> {
  // env 없으면 게스트 모드 (로컬 미설정 환경에서 UI 확인 가능)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  const sb = createSupabaseServerClient(cookieStore);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await sb
    .from('profiles')
    .select('display_name, current_workspace_id')
    .eq('id', user.id)
    .single();

  let role: SessionContext['role'] = null;
  if (profile?.current_workspace_id) {
    const { data: m } = await sb
      .from('memberships')
      .select('role')
      .eq('workspace_id', profile.current_workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    role = (m?.role as SessionContext['role']) ?? null;
  }

  return {
    userId: user.id,
    email: user.email ?? '',
    displayName: profile?.display_name ?? null,
    workspaceId: profile?.current_workspace_id ?? null,
    role,
  };
}

// React cache로 같은 요청 내 중복 호출(페이지 + 사이드바 동시 호출) 1회로 dedupe.
export const getSession = cache(_getSession);
