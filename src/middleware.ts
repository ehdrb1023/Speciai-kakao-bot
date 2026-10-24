import { type NextFetchEvent, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth/middleware';
import { hardening } from '@/lib/security/hardening';

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  // 스캐너 상투 경로·관리자 탐색·robots 미끼는 세션 판정보다 먼저 404 로 끊는다.
  // 정상 사용자가 올 일이 없고, 여기서 끊어야 존재 자체가 드러나지 않는다.
  const blocked = hardening(req, event);
  if (blocked) return blocked;
  return updateSession(req);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
