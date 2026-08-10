import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { logAudit } from '@/server/audit';

// 방 상태 토글 — 고정(pinned) · 처리완료(handled) · 색상.
// 세 가지를 한 라우트로 묶은 이유: 전부 kakao_rooms 한 행의 컬럼 하나만 바꾸는 동작이라
// 라우트를 쪼개면 같은 인증·소유권 검사가 세 벌로 복제된다.

const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'gray'] as const;

export async function POST(req: Request) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    pinned?: boolean;
    handled?: boolean;
    color?: string | null;
  } | null;

  if (!body?.roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pinned === 'boolean') {
    patch.pinned_at = body.pinned ? new Date().toISOString() : null;
  }
  if (typeof body.handled === 'boolean') {
    patch.handled_at = body.handled ? new Date().toISOString() : null;
  }
  if (body.color !== undefined) {
    if (body.color !== null && !COLORS.includes(body.color as (typeof COLORS)[number])) {
      return NextResponse.json({ error: '허용되지 않은 색상' }, { status: 400 });
    }
    patch.color = body.color;
  }

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('kakao_rooms')
    .update(patch)
    .eq('id', body.roomId)
    .eq('workspace_id', session.workspaceId);

  if (error) {
    console.error('[kakao] 방 상태 변경 실패', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    action: 'kakao.room.state',
    targetTable: 'kakao_rooms',
    targetId: body.roomId,
    meta: patch,
  });

  return NextResponse.json({ ok: true });
}
