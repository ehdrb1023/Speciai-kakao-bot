import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/auth/server';

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
