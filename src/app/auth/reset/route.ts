import { NextResponse, type NextRequest } from 'next/server';

// 431 Request Header Fields Too Large 복구용 라우트.
// 미들웨어가 쿠키 폭주를 감지하면 여기로 보낸다. 모든 sb-* 인증 쿠키를 깨끗이 지우고
// sign-in으로 돌려보내 정상 로그인 흐름으로 복귀시킨다.
export function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  const redirectUrl = req.nextUrl.clone();
  redirectUrl.pathname = '/auth/sign-in';
  redirectUrl.search = `?next=${encodeURIComponent(next)}`;
  const res = NextResponse.redirect(redirectUrl);
  for (const c of req.cookies.getAll()) {
    if (/^sb-.*-auth-token(\.\d+)?$/.test(c.name)) {
      res.cookies.set(c.name, '', { path: '/', maxAge: 0 });
    }
  }
  return res;
}
