import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { listRoomMessages } from '@/server/kakao';

// 방 대화 지연 로드. 초기 렌더는 첫 방만 싣고, 나머지는 클릭 시 여기로 가져온다.
export async function GET(req: Request) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const roomId = new URL(req.url).searchParams.get('roomId');
  if (!roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 });
  }

  const sb = createSupabaseServerClient(await cookies());
  const messages = await listRoomMessages(sb, session.workspaceId, roomId);
  return NextResponse.json({ messages });
}
