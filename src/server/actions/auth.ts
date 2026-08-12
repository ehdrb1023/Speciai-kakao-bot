'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/auth/server';

async function getOrigin() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host') ?? 'localhost:3001';
  return `${proto}://${host}`;
}

export async function signInWithKakao() {
  const sb = createSupabaseServerClient(await cookies());
  const origin = await getOrigin();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'no_oauth_url' };
  return { url: data.url };
}

// 이메일·비밀번호 로그인 — 카카오 개발자 앱 없이 쓸 수 있는 기본 경로.
// 카카오 OAuth 는 그대로 두고 병행한다(둘 중 편한 쪽으로 들어오면 된다).
export async function signInWithEmail(email: string, password: string) {
  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    // Supabase 원문은 영문이라 자주 나오는 것만 한국어로 바꿔준다.
    if (error.message.includes('Invalid login credentials')) {
      return { error: '이메일 또는 비밀번호가 맞지 않습니다.' };
    }
    if (error.message.includes('Email not confirmed')) {
      return { error: '이메일 인증이 완료되지 않았습니다. Supabase 에서 이메일 확인을 끄거나 인증 메일을 확인하세요.' };
    }
    return { error: error.message };
  }
  return { ok: true };
}

export async function signUpWithEmail(email: string, password: string) {
  const sb = createSupabaseServerClient(await cookies());
  const origin = await getOrigin();
  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    if (error.message.includes('already registered')) {
      return { error: '이미 가입된 이메일입니다. 로그인해 주세요.' };
    }
    return { error: error.message };
  }
  // 이메일 확인이 켜져 있으면 session 이 null 로 온다 — 이 경우 바로 로그인되지 않는다.
  if (!data.session) {
    return { ok: true, needsConfirm: true };
  }
  return { ok: true };
}

// 비밀번호 재설정 메일 발송.
// 가입 안 된 이메일이어도 성공과 같은 응답을 준다 — 응답이 갈리면 어떤 이메일이
// 가입돼 있는지 확인하는 통로가 된다(user enumeration).
export async function requestPasswordReset(email: string) {
  const sb = createSupabaseServerClient(await cookies());
  const origin = await getOrigin();
  // 메일 링크는 code 를 달고 /auth/callback 으로 온다. 세션을 심은 뒤 재설정 폼으로 넘긴다.
  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/auth/new-password')}`,
  });
  // 레이트리밋만은 알려준다. 안 그러면 "보냈다는데 안 온다" 로 오해한다.
  if (error && /rate limit|seconds|too many/i.test(error.message)) {
    return { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}

// 재설정 링크로 들어와 세션이 심긴 상태에서 새 비밀번호를 저장한다.
export async function updatePassword(password: string) {
  const sb = createSupabaseServerClient(await cookies());
  // 링크 만료·직접 URL 진입 방어. 세션이 없으면 updateUser 가 엉뚱한 오류를 낸다.
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return { error: '재설정 링크가 만료되었습니다. 메일을 다시 요청해 주세요.' };
  }
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    if (error.message.includes('should be at least')) {
      return { error: '비밀번호는 6자 이상이어야 합니다.' };
    }
    if (error.message.includes('different from the old')) {
      return { error: '기존과 다른 비밀번호를 입력해 주세요.' };
    }
    return { error: error.message };
  }
  return { ok: true };
}

export async function signOut() {
  const sb = createSupabaseServerClient(await cookies());
  await sb.auth.signOut();
  redirect('/auth/sign-in');
}
