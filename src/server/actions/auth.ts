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

export async function signOut() {
  const sb = createSupabaseServerClient(await cookies());
  await sb.auth.signOut();
  redirect('/auth/sign-in');
}
