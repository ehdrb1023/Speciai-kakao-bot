import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/db';
import { loadRules, resolveBotWorkspace, sortRules } from '@/server/kakao';
import { ingestTokenValid } from '@/server/kakao/ingest-token';

// 봇 단말이 내려받는 방 필터 규칙.
//
// 봇은 이 목록에 걸리는 방만 서버로 보낸다. 대시보드에서 거래처·규칙을 추가하면
// 다음 갱신(봇 기본 10분) 때 단말에 반영되므로 S21 을 만질 필요가 없다.
// 규칙에 안 걸리는 개인 카톡·가족방은 단말 밖으로 나가지 않는다.
//
// 인증: X-Ingest-Token = KAKAO_INGEST_TOKEN (인입과 같은 토큰)
// 출력: { version, rules: [{ kind, pattern }] }
//   version 이 지난번과 같으면 봇은 목록을 다시 만들지 않는다.
//   거래처 이름·id 는 내려보내지 않는다 — 단말이 알 필요가 없고, 유출면만 넓힌다.

export async function GET(req: Request) {
  if (!ingestTokenValid(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const ws = await resolveBotWorkspace(sb);
  if (!ws.workspaceId) {
    console.error('[kakao] 규칙 배포 거부 —', ws.reason);
    return NextResponse.json({ error: ws.reason ?? '워크스페이스를 정할 수 없습니다' }, { status: 503 });
  }
  const workspaceId = ws.workspaceId;

  const rules = sortRules(await loadRules(sb, workspaceId)).map((r) => ({
    kind: r.kind,
    pattern: r.pattern,
  }));

  const version = createHash('md5').update(JSON.stringify(rules)).digest('hex').slice(0, 12);

  return NextResponse.json(
    { version, rules },
    // 봇이 짧은 주기로 물어와도 부담이 없도록 짧게 캐시한다.
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
