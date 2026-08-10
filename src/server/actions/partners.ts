'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { canManageMembers } from '@/lib/auth';
import { matchRoomRule, normalizeRoomName, ruleMatches, type RoomRuleKind } from '@/server/kakao/rules';
import { logAudit } from '../audit';

// 거래처·방 매칭 규칙 CRUD. 대시보드 "거래처" 탭이 쓴다.

export interface PartnerRow {
  id: string;
  name: string;
  color: string | null;
  memo: string | null;
  rules: RuleRow[];
  roomCount: number;
}

export interface RuleRow {
  id: string;
  partnerId: string;
  kind: RoomRuleKind;
  pattern: string;
  priority: number;
  enabled: boolean;
}

const KINDS: RoomRuleKind[] = ['prefix', 'exact', 'contains', 'regex'];

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

  const rulesByPartner = new Map<string, RuleRow[]>();
  for (const r of rules ?? []) {
    const row: RuleRow = {
      id: r.id as string,
      partnerId: r.partner_id as string,
      kind: r.kind as RoomRuleKind,
      pattern: r.pattern as string,
      priority: r.priority as number,
      enabled: r.enabled as boolean,
    };
    const list = rulesByPartner.get(row.partnerId) ?? [];
    list.push(row);
    rulesByPartner.set(row.partnerId, list);
  }

  return (partners ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    color: (p.color as string | null) ?? null,
    memo: (p.memo as string | null) ?? null,
    rules: rulesByPartner.get(p.id as string) ?? [],
    roomCount: roomCounts.get(p.id as string) ?? 0,
  }));
}

export async function createPartner(input: {
  name: string;
  pattern?: string;
  kind?: RoomRuleKind;
}): Promise<{ error?: string; partnerId?: string }> {
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

  // 거래처만 만들고 규칙이 없으면 아무 방도 안 붙는다. 기본 규칙을 같이 만들어 그 상태를 피한다.
  const pattern = normalizeRoomName(input.pattern ?? `[${name}]`);
  if (pattern) {
    const ruleResult = await upsertRule({
      partnerId,
      kind: input.kind ?? 'prefix',
      pattern,
      priority: 0,
      enabled: true,
    });
    if (ruleResult.error) return { partnerId, error: `거래처는 만들었지만 규칙 등록 실패: ${ruleResult.error}` };
  }

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

export async function upsertRule(input: {
  id?: string;
  partnerId: string;
  kind: RoomRuleKind;
  pattern: string;
  priority?: number;
  enabled?: boolean;
}): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const pattern = normalizeRoomName(input.pattern);
  if (!pattern) return { error: '패턴을 입력하세요' };
  if (!KINDS.includes(input.kind)) return { error: '알 수 없는 규칙 종류입니다' };
  if (input.kind === 'regex') {
    try {
      new RegExp(pattern);
    } catch {
      return { error: '정규식 문법이 잘못됐습니다' };
    }
  }

  const sb = createSupabaseServerClient(await cookies());
  const row = {
    workspace_id: session.workspaceId,
    partner_id: input.partnerId,
    kind: input.kind,
    pattern,
    priority: input.priority ?? 0,
    enabled: input.enabled ?? true,
    updated_at: new Date().toISOString(),
  };

  const { error } = input.id
    ? await sb.from('partner_room_rules').update(row).eq('id', input.id).eq('workspace_id', session.workspaceId)
    : await sb.from('partner_room_rules').insert(row);

  if (error) {
    return {
      error:
        error.code === '23505'
          ? '같은 패턴이 이미 다른 거래처에 등록돼 있습니다'
          : error.message,
    };
  }

  await logAudit({ action: 'partner.rule.upsert', targetTable: 'partner_room_rules', targetId: input.partnerId });
  revalidatePath('/');
  return {};
}

export async function deleteRule(id: string): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('partner_room_rules')
    .delete()
    .eq('id', id)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  await logAudit({ action: 'partner.rule.delete', targetTable: 'partner_room_rules', targetId: id });
  revalidatePath('/');
  return {};
}

/**
 * 규칙 시험 — 방 이름을 넣으면 어느 거래처로 붙는지 미리 본다.
 * 접두어 오타("[삼성전자 ]")로 조용히 아무것도 안 걸리는 상황을 등록 전에 잡기 위함.
 */
export async function testRoomName(roomName: string): Promise<{
  matchedPartner: string | null;
  candidates: { partner: string; kind: RoomRuleKind; pattern: string }[];
}> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { matchedPartner: null, candidates: [] };

  const sb = createSupabaseServerClient(await cookies());
  const { data } = await sb
    .from('partner_room_rules')
    .select('id, partner_id, kind, pattern, priority, partners(name)')
    .eq('workspace_id', session.workspaceId)
    .eq('enabled', true);

  const rows = (data ?? []).map((r) => {
    const p = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    return {
      id: r.id as string,
      partnerId: r.partner_id as string,
      kind: r.kind as RoomRuleKind,
      pattern: r.pattern as string,
      priority: r.priority as number,
      partnerName: (p as { name: string } | null)?.name ?? '(이름 없음)',
    };
  });

  const winner = matchRoomRule(roomName, rows);
  return {
    matchedPartner: winner ? rows.find((r) => r.id === winner.id)?.partnerName ?? null : null,
    candidates: rows
      .filter((r) => ruleMatches(r, roomName))
      .map((r) => ({ partner: r.partnerName, kind: r.kind, pattern: r.pattern })),
  };
}

/**
 * 미분류 방을 거래처에 붙인다. 규칙을 새로 만들고, 이미 쌓인 미분류 기록을 정리한다.
 * 단, 지난 메시지는 되살아나지 않는다 — 미분류 구간에는 본문을 저장하지 않았기 때문.
 */
export async function adoptUnmatchedRoom(input: {
  unmatchedId: string;
  partnerId: string;
  kind: RoomRuleKind;
  pattern: string;
}): Promise<{ error?: string }> {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (!canManageMembers(session.role)) return { error: '권한이 없습니다' };

  const result = await upsertRule({
    partnerId: input.partnerId,
    kind: input.kind,
    pattern: input.pattern,
  });
  if (result.error) return result;

  const sb = createSupabaseServerClient(await cookies());
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
