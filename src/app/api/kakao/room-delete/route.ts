import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { logAudit } from '@/server/audit';

// 방 숨김/복구 (soft delete). 대화 기록은 지우지 않는다 — 나중에 "그때 뭐라고 했더라"가
// 반드시 나오기 때문. 목록에서만 내린다.
export async function POST(req: Request) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    restore?: boolean;
  } | null;
  if (!body?.roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const restore = !!body.restore;
  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('kakao_rooms')
    .update({ deleted_at: restore ? null : new Date().toISOString() })
    .eq('id', body.roomId)
    .eq('workspace_id', session.workspaceId);

  if (error) {
    console.error('[kakao] 방 숨김 처리 실패', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    action: restore ? 'kakao.room.restore' : 'kakao.room.delete',
    targetTable: 'kakao_rooms',
    targetId: body.roomId,
  });

  return NextResponse.json({ ok: true });
}
