import { NextResponse } from 'next/server';
import { ackOutbound, claimOutbound, resolveBotWorkspace } from '@/server/kakao';
import { getServerClient } from '@/lib/db';
import { ingestTokenValid } from '@/server/kakao/ingest-token';
import { logAuditMachine } from '@/server/audit';

// 봇이 "보낼 것 있나" 를 물어보는 곳. 인입과 반대 방향이다.
//
// 인증: X-Ingest-Token (인입·규칙 조회와 같은 토큰) → service-role 로 RLS 우회
// 입력: { acks?: [{ id, ok, error? }] }   직전에 가져간 것들의 전송 결과
// 출력: { ok, outbox: [{ id, room, text }] }
//
// 결과 보고와 새 작업 수령을 한 번의 왕복으로 묶은 이유: 봇은 폰이고 네트워크가 자주 끊긴다.
// 왕복이 둘이면 "보내긴 했는데 결과를 못 알린" 구간이 두 배로 늘어난다.
//
// 같은 건이 두 번 나가지 않는 근거는 claim 이다 — 내려준 순간 sending 으로 잠기고,
// 2분 안에 결과가 없을 때만 pending 으로 되살아난다.

export async function POST(req: Request) {
  if (!ingestTokenValid(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    acks?: Array<{ id?: string; ok?: boolean; error?: string }>;
  } | null;

  const sb = getServerClient();
  const ws = await resolveBotWorkspace(sb);
  if (!ws.workspaceId) {
    console.error('[kakao] 발신 조회 거부 —', ws.reason);
    return NextResponse.json({ error: ws.reason ?? '워크스페이스를 정할 수 없습니다' }, { status: 503 });
  }
  const workspaceId = ws.workspaceId;

  const acks = (body?.acks ?? [])
    .filter((a): a is { id: string; ok?: boolean; error?: string } => typeof a?.id === 'string')
    .map((a) => ({ id: a.id, ok: a.ok === true, error: a.error }));

  if (acks.length > 0) {
    const result = await ackOutbound(sb, workspaceId, acks);
    await logAuditMachine({
      action: 'kakao.bot.outbox',
      targetTable: 'kakao_outbound',
      meta: result,
    });
  }

  const outbox = await claimOutbound(sb, workspaceId, { limit: 10 });
  return NextResponse.json({ ok: true, outbox }, { headers: { 'Cache-Control': 'no-store' } });
}
