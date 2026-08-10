import { timingSafeEqual } from 'node:crypto';

// 머신 토큰 상수시간 비교 — 타이밍 오라클 차단(길이 다르면 즉시 false; 길이 자체는 비밀 아님).
function constantTimeEqual(token: string | null, expected: string | undefined): boolean {
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// 봇/파일 인입 엔드포인트 공용 토큰 검증.
export function ingestTokenValid(req: Request): boolean {
  return constantTimeEqual(req.headers.get('x-ingest-token'), process.env.KAKAO_INGEST_TOKEN);
}

// 카카오 상담톡 웹훅 토큰 검증.
export function webhookTokenValid(req: Request): boolean {
  return constantTimeEqual(
    req.headers.get('x-kakao-webhook-token'),
    process.env.KAKAO_CONSULT_WEBHOOK_TOKEN,
  );
}
