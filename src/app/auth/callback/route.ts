import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/auth/server';
import { getServerClient } from '@/lib/db';

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'ws'
  );
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  // 신 콘솔(console-v2)은 루트('/'). 구 대시보드(/dashboard)로 보내지 않는다.
  const nextParam = searchParams.get('next');
  const next = !nextParam || nextParam === '/dashboard' ? '/' : nextParam;

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=callback`);
  }

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=callback`);
  }

  // 카카오 신규 가입자는 workspace가 없어 / 진입 시 /onboarding 으로 튕긴다.
  // 사용자 경험상 로그인 직후 바로 카톡 콘솔(/)이 뜨도록, workspace 없으면 자동 생성한다.
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const { data: profile } = await sb
      .from('profiles')
      .select('current_workspace_id, display_name, email')
      .eq('id', user.id)
      .maybeSingle();

    // 초대받은 사람에게는 워크스페이스를 만들어주지 않는다.
    //
    // 예전에는 가입만 하면 무조건 자기 워크스페이스가 생겼다. 그래서 팀원을 초대해도
    // 그 사람은 **텅 빈 자기 워크스페이스**로 들어가 "아무것도 없는데요" 를 보게 되고,
    // 초대를 부를 때마다 워크스페이스가 하나씩 늘었다(2026-08-13, 3개까지 늘어난 뒤 발견).
    // 워크스페이스가 둘 이상이면 봇이 어디에 쌓을지 정하지 못하는 문제와도 이어진다.
    //
    // 그래서 대기 중인 초대가 있으면 만들지 않고 수락 화면으로 보낸다. 거기서 이메일이
    // 맞는지 한 번 더 보고 붙인다(acceptInvite).
    const email = (user.email ?? profile?.email ?? '').trim().toLowerCase();
    if (!profile?.current_workspace_id && email) {
      // 아직 아무 워크스페이스의 멤버가 아니라 invitations 의 RLS 에 걸린다. 조회만
      // service-role 로 하고, 실제 수락(권한 부여)은 acceptInvite 가 이메일을 대조한 뒤 한다.
      const { data: pending } = await getServerClient()
        .from('invitations')
        .select('token')
        .eq('email', email)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pending?.token) {
        return NextResponse.redirect(
          `${origin}/auth/invite?token=${encodeURIComponent(pending.token as string)}`,
        );
      }
    }

    if (!profile?.current_workspace_id) {
      const base =
        profile?.display_name ||
        (profile?.email ? profile.email.split('@')[0] : '') ||
        user.email?.split('@')[0] ||
        'ws';
      const wsName = `${base}의 워크스페이스`;
      const slug = `${slugify(base)}-${user.id.slice(0, 6)}`;
      const { error: rpcErr } = await sb.rpc('create_workspace', {
        p_name: wsName,
        p_slug: slug,
      });
      if (rpcErr) {
        // 자동 생성 실패 시 onboarding 으로 fallback
        return NextResponse.redirect(`${origin}/onboarding`);
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
