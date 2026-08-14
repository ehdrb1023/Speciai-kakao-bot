'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { getServerClient } from '@/lib/db';
import { isStaffSpeaker } from '@/server/kakao/rules';
import { logAudit } from '../audit';

/**
 * 워크스페이스는 사내 전용이라 하나뿐이다. 그래서 이름·식별자를 사람에게 묻지 않는다.
 *
 * 식별자(slug)는 화면 어디에도 안 나오고 URL 에도 안 쓴다 — DB 유니크 제약을 채우는 값이라
 * 사람이 정할 이유가 없다. 이름도 가입 시점에 물어봐야 알 수 있는 정보가 아니고, 잘못
 * 적어도 고칠 화면이 없어서 오히려 틀린 채로 굳는다. 회사명은 대시보드에서 거래처로 관리한다.
 */
const DEFAULT_WORKSPACE_NAME = '사내 워크스페이스';

/**
 * 두 번째 워크스페이스는 만들지 않는다.
 *
 * 이 화면의 버튼 하나가 사내 데이터를 둘로 쪼갠다. 새 계정이 여기서 만들기를 누르면 자기
 * 소유의 빈 워크스페이스가 생기고, 봇이 쌓는 곳과 사람이 보는 곳이 갈라진다(2026-08-13).
 * 초대장 유무로 걸러봐야 승인제로 바꾼 뒤로는 대기자에게 초대장이 없어 그대로 통과한다.
 *
 * 그래서 조건을 사람이 아니라 **DB 상태**로 둔다 — 이미 워크스페이스가 있으면 아무도 못
 * 만든다. 새 사람은 만드는 게 아니라 관리자 승인으로 기존 워크스페이스에 붙는다
 * (`members.ts` 의 `grantAccess`). 최초 1회 부트스트랩만 열어둔다.
 *
 * service-role 로 세는 이유: 아직 아무 워크스페이스의 멤버가 아닌 계정이라 RLS 로는
 * 남의 워크스페이스가 0개로 보인다. 그 눈으로 판단하면 매번 새로 만들게 된다.
 */
async function workspaceAlreadyExists(): Promise<boolean> {
  if (process.env.KAKAO_WORKSPACE_ID?.trim()) return true;
  const { count, error } = await getServerClient()
    .from('workspaces')
    .select('id', { count: 'exact', head: true });
  // 세지 못했으면 만들지 않는다 — fail-closed. 여기서 열어주면 되돌릴 수 없는 분열이 생긴다.
  if (error) return true;
  return (count ?? 0) > 0;
}

export async function createWorkspace() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) return { error: '로그인이 필요합니다' };

  if (await workspaceAlreadyExists()) {
    return { error: '사내 워크스페이스는 이미 있습니다. 관리자 승인을 기다려 주세요.' };
  }

  const sb = createSupabaseServerClient(cookieStore);

  // 무작위 slug 라 충돌은 사실상 없지만, 부딪히면 사용자에게 되묻지 않고 다시 뽑는다.
  let lastError = '워크스페이스 생성 실패';
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `ws-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const { data: wsId, error } = await sb.rpc('create_workspace', {
      p_name: DEFAULT_WORKSPACE_NAME,
      p_slug: slug,
    });

    if (!error && wsId) {
      await logAudit({
        action: 'workspace.create',
        targetTable: 'workspaces',
        targetId: wsId,
        meta: { name: DEFAULT_WORKSPACE_NAME, slug },
      });
      redirect('/');
    }

    if (error?.message.includes('slug_taken')) continue;
    if (error?.message.includes('not authenticated')) return { error: '인증 세션이 만료되었습니다' };
    if (error) return { error: error.message };
    lastError = '워크스페이스 생성 실패';
  }
  return { error: lastError };
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
      //
      // 대시보드에서 보낸 것(content_hash = 'out:<id>')은 제외한다. 그건 우리가 쓴 글이라는
      // 사실이 확정된 행이고, 별칭 목록으로 다시 판정할 대상이 아니다. 실제로 별칭을 비우자
      // 우리가 보낸 메시지가 전부 거래처 발화로 뒤집혔다(2026-08-12). 발화자명은 담당자
      // 계정 이름이지 카톡 닉네임이 아니라서, 별칭 목록에 있을 이유가 없다.
      const { data, error } = await sb
        .from('kakao_messages')
        .update({ side })
        .eq('workspace_id', workspaceId)
        .in('speaker', chunk)
        .neq('side', side)
        .not('content_hash', 'like', 'out:%')
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

/**
 * 발신 표시 이름 — 대시보드에서 쓴 글이 카톡방에 `[이 이름] 본문` 으로 나간다.
 *
 * 가입할 때 이메일 앞부분으로 자동 설정되는데(`martin1023`), 그 값이 그대로 거래처 방에
 * 찍힌다. 거래처가 보는 이름이므로 사람이 정할 수 있어야 한다. 바꿀 화면이 없어서
 * 아이디가 그대로 나가고 있었다(2026-08-12).
 *
 * 이 값은 계정별이다 — 담당자마다 자기 이름으로 나간다. 방 필터·발화자 판정과는 무관하고
 * (그건 workspaces.staff_aliases 가 본다), 이미 나간 메시지는 바뀌지 않는다.
 */
export async function saveDisplayName(name: string) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) return { error: '로그인이 필요합니다' };

  // 대괄호는 지운다 — 접두가 `[이름] 본문` 이라 이름 안에 대괄호가 있으면 거래처 화면에서
  // 접두가 어디서 끝나는지 알 수 없다(composeWireText 도 같은 이유로 지운다).
  const clean = name.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) return { error: '이름을 입력하세요' };

  const sb = createSupabaseServerClient(cookieStore);
  const { error } = await sb.from('profiles').update({ display_name: clean }).eq('id', session.userId);
  if (error) return { error: error.message };

  await logAudit({
    action: 'workspace.update',
    targetTable: 'profiles',
    targetId: session.userId,
    meta: { displayName: clean },
  });
  revalidatePath('/');
  return { name: clean };
}
