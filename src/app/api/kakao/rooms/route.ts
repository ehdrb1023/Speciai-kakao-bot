import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { listRooms } from '@/server/kakao';

// 방 목록 폴링용. 받은 카톡 화면이 30초마다 여기만 물어본다.
//
// 대화 본문은 담지 않는다 — 방 30~40개짜리 워크스페이스에서 매 주기마다 전체 대화를
// 실어 보내면 응답이 수 MB 가 된다. 목록만 보내고, 열어둔 방에 새 메시지가 있을 때만
// 클라이언트가 /api/kakao/thread 를 한 번 더 부른다.
export async function GET() {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createSupabaseServerClient(await cookies());
  const rooms = await listRooms(sb, session.workspaceId);
  // 폴링이라 캐시가 붙으면 갱신이 안 되는 것과 같아진다.
  return NextResponse.json({ rooms }, { headers: { 'Cache-Control': 'no-store' } });
}
