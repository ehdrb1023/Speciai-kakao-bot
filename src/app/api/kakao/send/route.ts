import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { cancelOutbound, queueOutbound } from '@/server/kakao';
import { logAudit } from '@/server/audit';

// 대시보드에서 쓴 글을 발신 큐에 적는다. 여기서 카톡으로 나가지는 않는다 —
// 서버는 카톡에 말할 수 없고, 봇 단말이 가져가 보낸다(api/kakao/bot/outbox).
//
// 그래서 응답의 status 는 항상 'pending' 이다. 화면은 이것을 "보냄" 이 아니라 "대기" 로
// 보여야 한다. 실제로 나갔는지는 봇이 결과를 알려준 뒤에만 알 수 있다.

export async function POST(req: Request) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // viewer 는 열람 전용이다. RLS 는 멤버 여부만 보므로 권한 구분은 여기서 한다.
  if (session.role === 'viewer') {
    return NextResponse.json({ error: '열람 권한으로는 보낼 수 없습니다' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    body?: string;
  } | null;

  if (!body?.roomId || !body.body?.trim()) {
    return NextResponse.json({ error: 'roomId 와 내용이 필요합니다' }, { status: 400 });
  }

  const sb = createSupabaseServerClient(await cookies());

  // 연결이 끊긴 방으로는 보내지 않는다. 봇은 규칙에 없는 방의 알림을 붙들고 있지 않아
  // 어차피 나가지 않고, 실패 건만 쌓인다.
  const { data: room, error: roomErr } = await sb
    .from('kakao_rooms')
    .select('id, room_name, partner_id')
    .eq('id', body.roomId)
    .eq('workspace_id', session.workspaceId)
    .maybeSingle();

  if (roomErr || !room) {
    return NextResponse.json({ error: '방을 찾을 수 없습니다' }, { status: 404 });
  }
  if (!room.partner_id) {
    return NextResponse.json(
      { error: '거래처에 연결되지 않은 방입니다. 카톡방에서 #등록 을 먼저 해주세요' },
      { status: 400 },
    );
  }

  const authorName = displayNameOf(session.displayName, session.email);
  const result = await queueOutbound(sb, {
    workspaceId: session.workspaceId,
    roomId: room.id as string,
    body: body.body,
    authorName,
    authorId: session.userId,
  });

  if (!result.ok || !result.row) {
    return NextResponse.json({ error: result.error ?? '전송 대기 실패' }, { status: 400 });
  }

  await logAudit({
    action: 'kakao.outbound.queue',
    targetTable: 'kakao_outbound',
    targetId: result.row.id,
    meta: { room: room.room_name, length: result.row.body.length },
  });

  return NextResponse.json({ ok: true, outbound: result.row });
}

export async function DELETE(req: Request) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (session.role === 'viewer') {
    return NextResponse.json({ error: '열람 권한으로는 취소할 수 없습니다' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = createSupabaseServerClient(await cookies());
  const result = await cancelOutbound(sb, session.workspaceId, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? '취소 실패' }, { status: 409 });
  }

  await logAudit({ action: 'kakao.outbound.cancel', targetTable: 'kakao_outbound', targetId: id });
  return NextResponse.json({ ok: true });
}

/** 접두에 쓸 이름. 이름을 안 정해둔 계정은 이메일 앞부분이라도 붙인다 — 익명보다는 낫다. */
function displayNameOf(displayName: string | null, email: string): string {
  const name = displayName?.trim();
  if (name) return name;
  return email.split('@')[0] || '담당자';
}
