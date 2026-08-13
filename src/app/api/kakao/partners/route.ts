import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { listUnmatchedRooms } from '@/server/kakao';
import { listPartners } from '@/server/actions/partners';

// 거래처 탭 폴링용.
//
// 방↔거래처 연결은 이 화면이 아니라 **카톡방 안에서** `#등록` 으로 만들어진다. 브라우저는
// 그 일이 일어난 것을 알 방법이 없어서, 폴링이 없으면 사람이 방에서 명령을 치고 화면으로
// 돌아와도 "연결된 방이 없습니다" 가 그대로 있고 새로고침해야만 확인된다.
// 안내문이 "방에서 #등록 을 치세요" 라고 시켜놓고 그 결과를 안 보여주면 명령이 먹혔는지
// 오타였는지를 사람이 알 수 없다.
//
// 페이지 전체를 다시 그리지 않고(=router.refresh) 이 두 목록만 보내는 이유: 페이지 로드는
// 멤버·초대·메시지 수·첫 방 대화까지 8개 쿼리를 돌린다. 여기 필요한 것은 거래처와 미분류
// 방뿐이다.
export async function GET() {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createSupabaseServerClient(await cookies());
  const [partners, unmatched] = await Promise.all([
    listPartners(),
    listUnmatchedRooms(sb, session.workspaceId),
  ]);

  return NextResponse.json(
    {
      partners,
      unmatched: unmatched.map((u) => ({
        id: u.id,
        roomName: u.roomName,
        hitCount: u.hitCount,
        lastSeenAt: u.lastSeenAt,
      })),
    },
    // 폴링이라 캐시가 붙으면 갱신이 안 되는 것과 같아진다.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
