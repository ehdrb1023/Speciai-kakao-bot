'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { canManageMembers } from '@/lib/auth';
import { normalizeRoomName, type RoomRuleKind } from '@/server/kakao/rules';
import { escapeLikePattern } from '@/server/kakao/commands';
import { logAudit } from '../audit';

// 거래처 CRUD. 대시보드 "거래처" 탭이 쓴다.
//
// 대시보드는 회사명만 관리한다. 방↔거래처 연결은 카톡방에서 "#등록 <회사명>" 으로 만든다.
// 여기서 방 이름 패턴을 편집하지 않는 이유: 패턴을 사람이 손으로 맞추게 하면 대괄호 하나
// 빠뜨린 규칙이 섞이고, 그 방은 아무 소리 없이 수집되지 않는다. 방에서 한 번 선언하는
// 쪽이 틀릴 여지가 적다.

export interface PartnerRow {
  id: string;
  name: string;
  color: string | null;
  memo: string | null;
  /** "#등록" 으로 붙은 방들 */
  rooms: BoundRoomRow[];
  /**
   * 패턴 방식이던 시절에 만든 접두어·포함·정규식 규칙. 새로 만들 수는 없지만
   * 남아 있으면 계속 매칭되므로 화면에 보여주고 지울 수 있게 한다.
   */
  legacyRules: RuleRow[];
  roomCount: number;
}

export interface BoundRoomRow {
  /** partner_room_rules 행 id. 연결 해제에 쓴다. */
  ruleId: string;
  roomName: string;
}

export interface RuleRow {
  id: string;
  partnerId: string;
  kind: RoomRuleKind;
  pattern: string;
  priority: number;
  enabled: boolean;
}

export async function listPartners(): Promise<PartnerRow[]> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return [];
  const sb = createSupabaseServerClient(await cookies());

  const [{ data: partners, error: pErr }, { data: rules }, { data: rooms }] = await Promise.all([
    sb
      .from('partners')
      .select('id, name, color, memo')
      .eq('workspace_id', session.workspaceId)
      .order('name', { ascending: true }),
    sb
      .from('partner_room_rules')
      .select('id, partner_id, kind, pattern, priority, enabled')
      .eq('workspace_id', session.workspaceId),
    sb
      .from('kakao_rooms')
      .select('partner_id')
      .eq('workspace_id', session.workspaceId)
      .is('deleted_at', null),
  ]);

  if (pErr) {
    console.error('[partners] 조회 실패', pErr.message);
    return [];
  }

  const roomCounts = new Map<string, number>();
  for (const r of rooms ?? []) {
    const id = r.partner_id as string | null;
    if (id) roomCounts.set(id, (roomCounts.get(id) ?? 0) + 1);
  }

  // exact = "#등록" 으로 붙은 방. 나머지 종류는 패턴 방식이던 시절의 잔재다.
  const roomsByPartner = new Map<string, BoundRoomRow[]>();
  const legacyByPartner = new Map<string, RuleRow[]>();
  for (const r of rules ?? []) {
    const partnerId = r.partner_id as string;
    if ((r.kind as RoomRuleKind) === 'exact') {
      const list = roomsByPartner.get(partnerId) ?? [];
      list.push({ ruleId: r.id as string, roomName: r.pattern as string });
      roomsByPartner.set(partnerId, list);
      continue;
    }
    const list = legacyByPartner.get(partnerId) ?? [];
    list.push({
      id: r.id as string,
      partnerId,
      kind: r.kind as RoomRuleKind,
      pattern: r.pattern as string,
      priority: r.priority as number,
      enabled: r.enabled as boolean,
    });
    legacyByPartner.set(partnerId, list);
  }

  return (partners ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    color: (p.color as string | null) ?? null,
    memo: (p.memo as string | null) ?? null,
    rooms: (roomsByPartner.get(p.id as string) ?? []).sort((a, b) =>
      a.roomName.localeCompare(b.roomName),
    ),
    legacyRules: legacyByPartner.get(p.id as string) ?? [],
    roomCount: roomCounts.get(p.id as string) ?? 0,
  }));
}

/**
 * 거래처 등록 — 회사명만 받는다.
 *
 * 방은 여기서 붙이지 않는다. 이 이름을 카톡방에서 "#등록 <회사명>" 으로 치면 그때 붙는다.
 */
export async function createPartner(input: { name: string }): Promise<{
  error?: string;
  partnerId?: string;
}> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const name = normalizeRoomName(input.name);
  if (!name) return { error: '거래처명을 입력하세요' };

  const sb = createSupabaseServerClient(await cookies());
  const { data, error } = await sb
    .from('partners')
    .insert({ workspace_id: session.workspaceId, name })
    .select('id')
    .single();

  if (error) {
    return { error: error.code === '23505' ? '이미 있는 거래처명입니다' : error.message };
  }

  const partnerId = data.id as string;
  await logAudit({ action: 'partner.create', targetTable: 'partners', targetId: partnerId });
  revalidatePath('/');
  return { partnerId };
}

export async function updatePartner(input: {
  id: string;
  name?: string;
  color?: string | null;
  memo?: string | null;
}): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = normalizeRoomName(input.name);
    if (!name) return { error: '거래처명을 입력하세요' };
    patch.name = name;
  }
  if (input.color !== undefined) patch.color = input.color;
  if (input.memo !== undefined) patch.memo = input.memo;

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('partners')
    .update(patch)
    .eq('id', input.id)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  await logAudit({ action: 'partner.update', targetTable: 'partners', targetId: input.id });
  revalidatePath('/');
  return {};
}

export async function deletePartner(id: string): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  // 규칙은 FK cascade 로 함께 지워진다. 방은 partner_id 가 null 이 되어 미분류로 남는다
  // (on delete set null) — 지금까지 모은 대화를 거래처 삭제로 잃지 않게 하기 위함.
  const { error } = await sb
    .from('partners')
    .delete()
    .eq('id', id)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  await logAudit({ action: 'partner.delete', targetTable: 'partners', targetId: id });
  revalidatePath('/');
  return {};
}

/**
 * 방을 거래처에 연결한다 — 방 이름과 정확히 일치하는 exact 규칙 1건을 만든다.
 *
 * 평소에는 카톡방에서 "#등록 <회사명>" 으로 연결한다. 이 함수는 콘솔에서 미분류 방을
 * 보고 직접 붙일 때 쓴다(봇 폰 주인 본인은 자기 발화가 알림에 안 떠서 방에서 명령을
 * 칠 수 없다 — 그 경우의 유일한 통로다).
 */
export async function linkRoom(input: {
  partnerId: string;
  roomName: string;
}): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const pattern = normalizeRoomName(input.roomName);
  if (!pattern) return { error: '방 이름이 비어 있습니다' };

  const sb = createSupabaseServerClient(await cookies());

  // 이미 다른 거래처에 붙어 있으면 옮긴다. 유니크는 (workspace, kind, lower(pattern)) 이라
  // 그냥 insert 하면 23505 로 막히고, 사용자는 왜 안 되는지 알 수 없다.
  const { data: existing } = await sb
    .from('partner_room_rules')
    .select('id')
    .eq('workspace_id', session.workspaceId)
    .eq('kind', 'exact')
    .ilike('pattern', escapeLikePattern(pattern))
    .maybeSingle();

  const now = new Date().toISOString();
  const { error } = existing
    ? await sb
        .from('partner_room_rules')
        .update({ partner_id: input.partnerId, enabled: true, updated_at: now })
        .eq('id', existing.id as string)
        .eq('workspace_id', session.workspaceId)
    : await sb.from('partner_room_rules').insert({
        workspace_id: session.workspaceId,
        partner_id: input.partnerId,
        kind: 'exact',
        pattern,
        priority: 100,
        enabled: true,
      });

  if (error) return { error: error.message };

  await logAudit({
    action: 'partner.room.link',
    targetTable: 'partner_room_rules',
    targetId: input.partnerId,
    meta: { room: pattern },
  });
  revalidatePath('/');
  return {};
}

/**
 * 방 연결 해제. 방에서 "#등록해제" 를 치는 것과 같은 결과다.
 * 이미 저장된 대화는 지워지지 않는다 — 지금부터 안 받는다는 뜻이다.
 */
export async function unlinkRoom(ruleId: string): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('partner_room_rules')
    .delete()
    .eq('id', ruleId)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  await logAudit({
    action: 'partner.room.unlink',
    targetTable: 'partner_room_rules',
    targetId: ruleId,
  });
  revalidatePath('/');
  return {};
}

/**
 * 미분류 방을 거래처에 붙인다. 방 이름은 미분류 기록에서 가져온다 — 사람이 다시 타이핑하면
 * 오타 한 글자로 안 붙는다.
 * 지난 메시지는 되살아나지 않는다. 미분류 구간에는 본문을 저장하지 않았기 때문이다.
 */
export async function adoptUnmatchedRoom(input: {
  unmatchedId: string;
  partnerId: string;
}): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { data: row } = await sb
    .from('kakao_unmatched_rooms')
    .select('room_name')
    .eq('id', input.unmatchedId)
    .eq('workspace_id', session.workspaceId)
    .maybeSingle();
  if (!row) return { error: '미분류 방을 찾을 수 없습니다' };

  const result = await linkRoom({
    partnerId: input.partnerId,
    roomName: row.room_name as string,
  });
  if (result.error) return result;

  await sb
    .from('kakao_unmatched_rooms')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', input.unmatchedId)
    .eq('workspace_id', session.workspaceId);

  revalidatePath('/');
  return {};
}

export async function dismissUnmatchedRoom(id: string): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('kakao_unmatched_rooms')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  revalidatePath('/');
  return {};
}
