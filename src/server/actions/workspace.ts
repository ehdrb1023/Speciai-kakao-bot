'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { logAudit } from '../audit';

export async function createWorkspace(data: { name: string; slug: string }) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) return { error: '로그인이 필요합니다' };

  const sb = createSupabaseServerClient(cookieStore);

  const { data: wsId, error } = await sb.rpc('create_workspace', {
    p_name: data.name,
    p_slug: data.slug,
  });
  if (error) {
    if (error.message.includes('slug_taken')) return { error: '이미 사용중인 식별자입니다' };
    if (error.message.includes('not authenticated')) return { error: '인증 세션이 만료되었습니다' };
    return { error: error.message };
  }
  if (!wsId) return { error: '워크스페이스 생성 실패' };

  await logAudit({
    action: 'workspace.create',
    targetTable: 'workspaces',
    targetId: wsId,
    meta: { name: data.name, slug: data.slug },
  });
  redirect('/');
}

/**
 * 우리측 카톡 닉네임 목록 저장. 이 이름들의 발화가 대화창에서 우측(노란 말풍선)에 붙는다.
 * 카톡 닉네임은 계정 display_name 과 다른 경우가 대부분이라 별도 목록으로 관리한다.
 */
export async function saveStaffAliases(aliases: string[]): Promise<{ error?: string }> {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };

  const cleaned = Array.from(
    new Set(aliases.map((a) => a.trim()).filter((a) => a.length > 0)),
  ).slice(0, 100);

  const sb = createSupabaseServerClient(cookieStore);
  const { error } = await sb
    .from('workspaces')
    .update({ staff_aliases: cleaned })
    .eq('id', session.workspaceId);
  if (error) return { error: error.message };

  await logAudit({
    action: 'workspace.update',
    targetTable: 'workspaces',
    targetId: session.workspaceId,
    meta: { staffAliasCount: cleaned.length },
  });
  revalidatePath('/');
  return {};
}

export async function switchWorkspace(workspaceId: string) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) return { error: '로그인이 필요합니다' };
  const sb = createSupabaseServerClient(cookieStore);
  const { error } = await sb
    .from('profiles')
    .update({ current_workspace_id: workspaceId })
    .eq('id', session.userId);
  if (error) return { error: error.message };
  await logAudit({
    action: 'workspace.switch',
    targetTable: 'workspaces',
    targetId: workspaceId,
  });
  revalidatePath('/');
  return {};
}
