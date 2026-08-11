'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { isStaffSpeaker } from '@/server/kakao/rules';
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
 *
 * 저장하면 이미 쌓인 메시지의 우리측/거래처 판정도 함께 다시 매긴다. side 는 인입 시점에
 * 확정해 저장하는 값이라, 이게 없으면 닉네임을 나중에 추가해도 지난 대화는 계속 거래처측
 * (왼쪽 흰 말풍선)으로 남는다. 사람이 들어오고 나갈 때마다 손보게 될 설정이라
 * 그때마다 SQL 을 치게 둘 수는 없다.
 */
export async function saveStaffAliases(
  aliases: string[],
): Promise<{ error?: string; reclassified?: number }> {
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

  const reclassified = await reclassifySides(sb, session.workspaceId, cleaned);

  await logAudit({
    action: 'workspace.update',
    targetTable: 'workspaces',
    targetId: session.workspaceId,
    meta: { staffAliasCount: cleaned.length, reclassified },
  });
  revalidatePath('/');
  return { reclassified };
}

/** in() 절 하나에 몰아넣을 발화자 수. URL 길이 제한에 걸리지 않는 선. */
const SPEAKER_CHUNK = 100;
/** 발화자 수집 페이지 크기와 상한. PostgREST 에 DISTINCT 가 없어 훑어서 모은다. */
const SPEAKER_PAGE = 1000;
const SPEAKER_MAX_PAGES = 200;

/**
 * 기존 메시지의 side 를 지금 별칭 목록으로 다시 판정한다.
 *
 * 판정은 서버 isStaffSpeaker 를 그대로 쓴다 — 같은 규칙을 SQL 로 옮겨 적으면 두 곳이
 * 어긋나서 화면과 저장값이 달라진다(3자 미만 별칭의 부분일치 제외 같은 것).
 */
async function reclassifySides(
  sb: SupabaseClient,
  workspaceId: string,
  aliases: string[],
): Promise<number> {
  const speakers = new Set<string>();
  for (let page = 0; page < SPEAKER_MAX_PAGES; page++) {
    const from = page * SPEAKER_PAGE;
    const { data, error } = await sb
      .from('kakao_messages')
      .select('speaker')
      .eq('workspace_id', workspaceId)
      .range(from, from + SPEAKER_PAGE - 1);
    if (error) {
      console.error('[workspace] 발화자 수집 실패', error.message);
      return 0;
    }
    for (const row of data ?? []) speakers.add(row.speaker as string);
    if (!data || data.length < SPEAKER_PAGE) break;
    if (page === SPEAKER_MAX_PAGES - 1) {
      // 여기까지 왔으면 메시지가 20만 건을 넘은 것이다. 그때는 DISTINCT 를 서버에서
      // 뽑는 RPC 로 바꿔야 한다. 조용히 일부만 고치고 끝내지 않도록 남긴다.
      console.error('[workspace] 발화자 수집 상한 도달 — 일부 메시지가 재판정되지 않았습니다');
    }
  }

  const us: string[] = [];
  const partner: string[] = [];
  for (const speaker of speakers) {
    (isStaffSpeaker(speaker, aliases) ? us : partner).push(speaker);
  }

  let changed = 0;
  for (const [side, list] of [
    ['us', us],
    ['partner', partner],
  ] as const) {
    for (let i = 0; i < list.length; i += SPEAKER_CHUNK) {
      const chunk = list.slice(i, i + SPEAKER_CHUNK);
      if (chunk.length === 0) continue;
      // 이미 맞는 행은 건드리지 않는다 — updated_at 도 없는 테이블이라 의미 없는 쓰기다.
      const { data, error } = await sb
        .from('kakao_messages')
        .update({ side })
        .eq('workspace_id', workspaceId)
        .in('speaker', chunk)
        .neq('side', side)
        .select('id');
      if (error) {
        console.error('[workspace] side 재판정 실패', error.message);
        continue;
      }
      changed += data?.length ?? 0;
    }
  }
  return changed;
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
