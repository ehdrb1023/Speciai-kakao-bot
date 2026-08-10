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

export async function signOut() {
  const sb = createSupabaseServerClient(await cookies());
  await sb.auth.signOut();
  redirect('/auth/sign-in');
}
