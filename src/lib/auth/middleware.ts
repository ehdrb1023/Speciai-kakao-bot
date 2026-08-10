import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/auth/sign-in',
  '/auth/callback',
  '/auth/invite',
  '/auth/reset', // stale 쿠키 fail-safe — 431 복구용
  '/onboarding',
  '/api/kakao/bot/ingest', // 온디바이스 봇 인입 (자체 X-Ingest-Token 검증)
  '/api/kakao/bot/rules', // 봇 방 필터 규칙 배포 (자체 X-Ingest-Token 검증)
  '/preview', // 목업 데이터 UI 확인 (로그인 없이. 프로덕션에서는 페이지가 스스로 404)
  '/_next',
  '/favicon',
];

// Vercel·Node 기본 헤더 한도(보통 16KB)에서 여유를 둔 쿠키 합산 한도.
// 이 값을 넘으면 sb-* 쿠키를 전부 비우고 sign-in으로 보낸다. 431 예방용.
// 정상 Supabase 토큰 1세트는 6~8KB이므로 임계치 13KB는 안전 마진.
const COOKIE_BYTE_BUDGET = 13 * 1024;

function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.*-auth-token(\.\d+)?$/.test(name);
}

export async function updateSession(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res;

  // 쿠키 합산 크기 점검 — 폭주 상태면 sb-* 쿠키를 전부 비우고 reset 라우트로
  const all = req.cookies.getAll();
  const totalBytes = all.reduce((acc, c) => acc + c.name.length + c.value.length + 3, 0);
  if (totalBytes > COOKIE_BYTE_BUDGET) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = '/auth/reset';
    redirect.searchParams.set('next', req.nextUrl.pathname);
    const wipeRes = NextResponse.redirect(redirect);
    for (const c of all) {
      if (isSupabaseAuthCookie(c.name)) {
        wipeRes.cookies.set(c.name, '', { path: '/', maxAge: 0 });
      }
    }
    return wipeRes;
  }

  const sb = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookies: Array<{ name: string; value: string; options?: CookieOptions }>) {
        for (const c of cookies) {
          req.cookies.set(c.name, c.value);
        }
        res = NextResponse.next({ request: req });
        for (const c of cookies) {
          // path '/' 강제 — 같은 이름이 path 별로 중복 set 되어 누적되는 것 방지
          res.cookies.set(c.name, c.value, { ...c.options, path: '/' });
        }
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  const pathname = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = '/auth/sign-in';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === '/auth/sign-in') {
    const redirect = req.nextUrl.clone();
    redirect.pathname = '/';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return res;
}
