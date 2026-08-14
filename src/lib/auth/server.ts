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

  const { data: rows } = await sb
    .from('memberships')
    .select('workspace_id, role')
    .eq('user_id', user.id);
  const memberships = (rows ?? []) as Array<{ workspace_id: string; role: SessionContext['role'] }>;

  const base = {
    userId: user.id,
    email: user.email ?? '',
    displayName: profile?.display_name ?? null,
  };

  // 워크스페이스는 하나뿐이고, 그 하나를 정하는 것은 KAKAO_WORKSPACE_ID 다.
  //
  // 예전에는 profiles.current_workspace_id 를 그대로 믿었다. 그런데 가입 직후 화면에서
  // 워크스페이스를 만들어버린 계정은 그 값이 **자기 소유의 빈 워크스페이스**를 가리킨다.
  // 그 상태로 콘솔에 들어가면 봇이 쌓는 곳이 아닌 다른 곳을 보게 되고, 거기서 만든 거래처와
  // 설정이 전부 엉뚱한 데 쌓인다. 2026-08-13 에 실제로 그렇게 됐다 — 대표 계정이 자기
  // 워크스페이스를 만들었고, 봇 연동 화면이 그 ID 를 배포 환경변수에 넣으라고 안내했고,
  // 그 값을 넣자 수집이 통째로 빈 워크스페이스로 넘어갔다.
  //
  // 그래서 방향을 뒤집었다. 환경변수가 앵커고 세션이 거기에 맞춘다 — 반대가 아니다.
  // 앵커의 멤버가 아니면 워크스페이스는 **없는 것으로 본다**(→ 승인 대기 화면).
  // 남아 있는 다른 워크스페이스로 흘러가느니 아무것도 안 보이는 편이 낫다.
  const anchor = process.env.KAKAO_WORKSPACE_ID?.trim();
  if (anchor) {
    const m = memberships.find((x) => x.workspace_id === anchor) ?? null;
    return { ...base, workspaceId: m ? anchor : null, role: m?.role ?? null };
  }

  // 앵커 미설정(로컬 개발 등)이면 예전대로 프로필의 기본 워크스페이스를 본다.
  const current = profile?.current_workspace_id ?? null;
  const m = memberships.find((x) => x.workspace_id === current) ?? null;
  return { ...base, workspaceId: current, role: m?.role ?? null };
}

// React cache로 같은 요청 내 중복 호출(페이지 + 사이드바 동시 호출) 1회로 dedupe.
export const getSession = cache(_getSession);
