import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStaffSpeaker, matchRoomRule, normalizeRoomName, type RoomRule } from './rules';
import { escapeLikePattern } from './commands';

export * from './rules';
export * from './commands';
export * from './outbound';

// 거래처 카톡 수집 — 파싱·매칭·멱등·집계는 전부 결정론. AI 추론 없음.

export interface RoomRow {
  id: string;
  roomKey: string;
  roomName: string;
  partnerId: string | null;
  partnerName: string | null;
  color: string | null;
  pinned: boolean;
  handled: boolean;
  lastMessageAt: string | null;
  preview: string;
  messageCount: number;
}

export interface MessageRow {
  id: string;
  speaker: string;
  body: string;
  side: 'us' | 'partner';
  sentAt: string;
  attachment: { path: string; type: string; name: string; url?: string } | null;
}

export interface UnmatchedRoomRow {
  id: string;
  roomKey: string;
  roomName: string;
  hitCount: number;
  lastSeenAt: string;
}

/**
 * 봇이 먹일 워크스페이스. 봇은 로그인 세션이 없어 워크스페이스를 스스로 모른다.
 * KAKAO_WORKSPACE_ID 를 명시하는 것이 정석이고, 미설정이면 워크스페이스가 딱 하나일 때만
 * 그것으로 폴백한다(1인 사무실 초기 세팅 편의). 둘 이상이면 null 을 돌려 인입을 막는다 —
 * 엉뚱한 워크스페이스에 거래처 대화를 쌓는 것보다 안 받는 편이 낫다.
 */
export async function resolveBotWorkspaceId(sb: SupabaseClient): Promise<string | null> {
  const fromEnv = process.env.KAKAO_WORKSPACE_ID?.trim();
  if (fromEnv) return fromEnv;

  const { data, error } = await sb.from('workspaces').select('id').limit(2);
  if (error) {
    console.error('[kakao] workspace 조회 실패', error.message);
    return null;
  }
  if (!data || data.length !== 1) return null;
  return data[0]!.id as string;
}

/** 활성 매칭 규칙 전부. 봇 선필터·서버 매칭이 같은 목록을 본다. */
export async function loadRules(sb: SupabaseClient, workspaceId: string): Promise<RoomRule[]> {
  const { data, error } = await sb
    .from('partner_room_rules')
    .select('id, partner_id, kind, pattern, priority')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true);
  if (error) {
    console.error('[kakao] 규칙 조회 실패', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    partnerId: r.partner_id as string,
    kind: r.kind as RoomRule['kind'],
    pattern: r.pattern as string,
    priority: r.priority as number,
  }));
}

async function loadStaffAliases(sb: SupabaseClient, workspaceId: string): Promise<string[]> {
  const { data } = await sb
    .from('workspaces')
    .select('staff_aliases')
    .eq('id', workspaceId)
    .maybeSingle();
  const raw = data?.staff_aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

/**
 * 멱등 키.
 *
 * 봇이 logId(메신저봇R API2 의 메시지 고유 id)를 주면 그걸 쓴다 — 가장 정확하다.
 * 없으면 분(minute) 단위로 자른 시각 + 발화자 + 본문을 해시한다. 봇 재전송·API2와 구API
 * 동시 수신 같은 중복은 초 단위로 발생하므로 분 버킷이면 잡히고, 나중에 같은 사람이 같은 말을
 * 다시 해도(예: "네") 별개 메시지로 남는다.
 */
export function contentHash(input: {
  logId?: string | null;
  sentAt: Date;
  speaker: string;
  body: string;
}): string {
  if (input.logId) return `log:${input.logId}`;
  const minute = input.sentAt.toISOString().slice(0, 16);
  return createHash('md5').update(`${minute}|${input.speaker}|${input.body}`).digest('hex');
}

export interface BotMessageInput {
  workspaceId: string;
  /** API2 chatId. 없으면 방 이름으로 대체 키를 만든다. */
  chatId?: string | null;
  roomName: string;
  speaker: string;
  text: string;
  logId?: string | null;
  ts?: string | null;
  attachment?: { path: string; type: string; name: string } | null;
  /**
   * 이미 매칭을 끝냈다면 그 결과를 넘긴다 — 규칙 조회를 한 번 더 하지 않기 위함.
   * 인입 라우트는 사진 업로드 전에 매칭을 먼저 확인해야 해서 이 경로를 쓴다
   * (미매칭 방의 사진이 버킷에 남으면 안 된다).
   */
  matched?: RoomRule;
}

/** 방 이름에 걸리는 규칙. 인입 라우트가 사진 업로드 전에 먼저 확인한다. */
export async function matchRoomForWorkspace(
  sb: SupabaseClient,
  workspaceId: string,
  roomName: string,
): Promise<RoomRule | null> {
  const rules = await loadRules(sb, workspaceId);
  return matchRoomRule(roomName, rules);
}

export interface BotMessageResult {
  ok: boolean;
  /** 규칙에 안 걸려 저장하지 않음. 봇에게 "이 방은 그만 보내라" 신호로도 쓴다. */
  unmatched?: boolean;
  inserted: number;
  skipped: number;
  roomId?: string;
  partnerId?: string | null;
  error?: string;
}

/**
 * 방 식별자. chatId 가 있으면 그것을 쓴다 — 방 제목이 바뀌어도 같은 방으로 이어진다.
 * 구 API(알림 기반)에는 chatId 가 없어 방 이름으로 대체한다.
 */
export function roomKeyOf(chatId: string | null | undefined, roomName: string): string {
  const id = chatId?.trim();
  if (id) return `chat:${id}`;
  return `name:${normalizeRoomName(roomName)}`;
}

/** 봇이 올린 메시지 1건 저장. service-role 클라이언트를 받아 RLS 를 우회한다. */
export async function ingestBotMessage(
  input: BotMessageInput,
  sb: SupabaseClient,
): Promise<BotMessageResult> {
  const roomName = normalizeRoomName(input.roomName);
  const speaker = normalizeRoomName(input.speaker);
  const body = input.text.trim();
  if (!roomName || !speaker || (!body && !input.attachment)) {
    return { ok: false, inserted: 0, skipped: 0, error: 'roomName·speaker·본문이 필요합니다' };
  }

  const roomKey = roomKeyOf(input.chatId, roomName);
  const matched = input.matched ?? (await matchRoomForWorkspace(sb, input.workspaceId, roomName));

  // 규칙 미매칭 — 본문을 저장하지 않는다. 개인 카톡이 여기까지 왔더라도 방 이름만 남는다.
  if (!matched) {
    await recordUnmatchedRoom(sb, input.workspaceId, roomKey, roomName);
    return { ok: true, unmatched: true, inserted: 0, skipped: 0 };
  }

  const room = await upsertRoom(sb, {
    workspaceId: input.workspaceId,
    roomKey,
    roomName,
    partnerId: matched.partnerId,
    matchedRuleId: matched.id,
  });
  if (!room) {
    return { ok: false, inserted: 0, skipped: 0, error: '방을 만들지 못했습니다' };
  }

  const sentAt = parseTs(input.ts);
  const aliases = await loadStaffAliases(sb, input.workspaceId);
  const side = isStaffSpeaker(speaker, aliases) ? 'us' : 'partner';
  const storedBody = body || `[사진] ${input.attachment?.name ?? '이미지'}`;

  const hash = contentHash({ logId: input.logId, sentAt, speaker, body: storedBody });

  // 완전 유니크 인덱스(room_id, content_hash) 라 onConflict 추론이 정상 동작한다.
  // ignoreDuplicates 로 중복은 조용히 흘려보내고 inserted 로만 구분한다.
  const { data: ins, error } = await sb
    .from('kakao_messages')
    .upsert(
      {
        workspace_id: input.workspaceId,
        room_id: room.id,
        speaker,
        body: storedBody,
        side,
        attachment: input.attachment ?? null,
        content_hash: hash,
        sent_at: sentAt.toISOString(),
      },
      { onConflict: 'room_id,content_hash', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    console.error('[kakao] 메시지 저장 실패', error.message);
    return { ok: false, inserted: 0, skipped: 0, roomId: room.id, error: error.message };
  }

  const inserted = (ins ?? []).length;
  if (inserted > 0) {
    await touchRoom(sb, room.id, sentAt, storedBody);
  }

  return {
    ok: true,
    inserted,
    skipped: inserted > 0 ? 0 : 1,
    roomId: room.id,
    partnerId: matched.partnerId,
  };
}

function parseTs(ts: string | null | undefined): Date {
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function upsertRoom(
  sb: SupabaseClient,
  input: {
    workspaceId: string;
    roomKey: string;
    roomName: string;
    partnerId: string;
    matchedRuleId: string;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await sb
    .from('kakao_rooms')
    .upsert(
      {
        workspace_id: input.workspaceId,
        room_key: input.roomKey,
        room_name: input.roomName,
        partner_id: input.partnerId,
        matched_rule_id: input.matchedRuleId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,room_key' },
    )
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[kakao] 방 upsert 실패', error.message);
    return null;
  }
  return data ? { id: data.id as string } : null;
}

/** 목록 정렬·미리보기용 파생 컬럼 갱신. 메시지가 실제로 새로 들어왔을 때만 부른다. */
async function touchRoom(sb: SupabaseClient, roomId: string, sentAt: Date, body: string) {
  const { count } = await sb
    .from('kakao_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  const { error } = await sb
    .from('kakao_rooms')
    .update({
      last_message_at: sentAt.toISOString(),
      last_preview: body.slice(0, 200),
      message_count: count ?? 0,
      // 새 메시지가 오면 처리완료를 해제한다 — 답장이 또 왔는데 목록에서 사라져 있으면 놓친다.
      handled_at: null,
      // 숨긴 방도 같은 이유로 되살린다. 살아 있는 방을 실수로 내렸을 때 그 뒤 대화를
      // 통째로 못 보게 되는 쪽이 훨씬 위험하다. 수집을 멈추려면 방 연결을 끊어야 한다.
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', roomId);
  if (error) console.error('[kakao] 방 갱신 실패', error.message);
}

/** 미분류 방 기록 — 이름과 횟수만. 본문은 저장하지 않는다. */
export async function recordUnmatchedRoom(
  sb: SupabaseClient,
  workspaceId: string,
  roomKey: string,
  roomName: string,
) {
  const { data: existing } = await sb
    .from('kakao_unmatched_rooms')
    .select('id, hit_count')
    .eq('workspace_id', workspaceId)
    .eq('room_key', roomKey)
    .maybeSingle();

  if (existing) {
    await sb
      .from('kakao_unmatched_rooms')
      .update({
        hit_count: (existing.hit_count as number) + 1,
        room_name: roomName,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id as string);
    return;
  }

  const { error } = await sb
    .from('kakao_unmatched_rooms')
    .insert({ workspace_id: workspaceId, room_key: roomKey, room_name: roomName });
  if (error) console.error('[kakao] 미분류 방 기록 실패', error.message);
}

// ── 방 등록/해제 (#등록 · #등록해제) ─────────────────────────────
//
// 방↔거래처 연결은 카톡방 안에서 "#등록 <회사명>" 으로만 만든다. 대시보드는 회사명만
// 관리하고 방 이름 패턴을 다루지 않는다 — 방 제목 관행을 지키게 만드는 대신, 방에서
// 한 번 선언하는 쪽이 실수가 적기 때문이다.
//
// 연결은 새 테이블 없이 exact 규칙 1건으로 표현한다. 그래야 규칙 조회·봇 배포·콘솔 편집이
// 전부 기존 경로를 그대로 탄다. 매칭 경로가 둘로 갈라지지 않는다.

export interface RoomBindResult {
  ok: boolean;
  /** 대시보드에 없는 회사명. 오타이거나 아직 거래처를 안 만든 것이다. */
  partnerMissing?: boolean;
  partnerId?: string;
  partnerName?: string;
  /** 다른 거래처에 붙어 있던 방을 옮겨왔으면 이전 거래처명 */
  rebindedFrom?: string;
  error?: string;
}

/**
 * "#등록 <회사명>" — 이 방을 대시보드에 등록된 거래처에 붙인다.
 *
 * 없는 회사명이면 만들지 않고 거부한다. 방에서 친 오타로 "삼성전쟈" 같은 거래처가
 * 생기면 아무도 눈치채지 못한 채 그 방 대화가 엉뚱한 곳에 쌓인다. 거래처를 만드는
 * 곳은 대시보드 한 곳으로 둔다.
 */
export async function bindRoomToPartner(
  sb: SupabaseClient,
  workspaceId: string,
  roomName: string,
  partnerName: string,
): Promise<RoomBindResult> {
  const pattern = normalizeRoomName(roomName);
  const name = normalizeRoomName(partnerName);
  if (!pattern || !name) return { ok: false, error: '방 이름과 거래처명이 필요합니다' };

  // partners_name_uniq 가 lower(name) 유니크라 대소문자만 다른 거래처는 같은 것으로 본다.
  const { data: found, error: findErr } = await sb
    .from('partners')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .ilike('name', escapeLikePattern(name))
    .maybeSingle();
  if (findErr) return { ok: false, error: findErr.message };
  if (!found) return { ok: false, partnerMissing: true };

  const partnerId = found.id as string;
  const partnerLabel = found.name as string;

  const { data: existing } = await sb
    .from('partner_room_rules')
    .select('id, partner_id, partners(name)')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'exact')
    .ilike('pattern', escapeLikePattern(pattern))
    .maybeSingle();

  const now = new Date().toISOString();
  let rebindedFrom: string | undefined;

  if (existing) {
    const rel = Array.isArray(existing.partners) ? existing.partners[0] : existing.partners;
    const prevName = (rel as { name: string } | null)?.name;
    if (prevName && existing.partner_id !== partnerId) rebindedFrom = prevName;

    const { error } = await sb
      .from('partner_room_rules')
      .update({ partner_id: partnerId, enabled: true, updated_at: now })
      .eq('id', existing.id as string);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await sb.from('partner_room_rules').insert({
      workspace_id: workspaceId,
      partner_id: partnerId,
      kind: 'exact',
      pattern,
      // 방에서 직접 지정한 것이 예전에 남아 있는 접두어 규칙보다 구체적인 의사표시다.
      priority: 100,
      enabled: true,
    });
    if (error) return { ok: false, error: error.message };
  }

  // 등록 전까지 미분류로 쌓인 흔적 정리. 실패해도 등록 자체는 성립하므로 막지 않는다.
  const { error: delErr } = await sb
    .from('kakao_unmatched_rooms')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('room_key', roomKeyOf(null, pattern));
  if (delErr) console.error('[kakao] 미분류 방 정리 실패', delErr.message);

  return { ok: true, partnerId, partnerName: partnerLabel, rebindedFrom };
}

export interface RoomUnbindResult {
  ok: boolean;
  /** 지운 exact 규칙 수. 0 이면 애초에 #등록 으로 붙은 방이 아니다. */
  removed: number;
  /**
   * 해제 후에도 다른 규칙(접두어 등)에 여전히 걸리는지.
   * true 면 수집이 멈추지 않는다 — 콘솔에서 그 규칙을 손봐야 한다.
   */
  stillMatched: boolean;
  error?: string;
}

export async function unbindRoom(
  sb: SupabaseClient,
  workspaceId: string,
  roomName: string,
): Promise<RoomUnbindResult> {
  const pattern = normalizeRoomName(roomName);
  if (!pattern) return { ok: false, removed: 0, stillMatched: false, error: '방 이름이 없습니다' };

  // 이 방 이름과 정확히 같은 exact 규칙만 지운다. 접두어 규칙까지 지우면 같은 접두어를
  // 쓰는 다른 방들의 수집이 통째로 멈춘다 — 방 하나 해제하려다 거래처 전체를 끊게 된다.
  const { data: removedRows, error } = await sb
    .from('partner_room_rules')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('kind', 'exact')
    .ilike('pattern', escapeLikePattern(pattern))
    .select('id');
  if (error) return { ok: false, removed: 0, stillMatched: false, error: error.message };

  const stillMatched = !!(await matchRoomForWorkspace(sb, workspaceId, pattern));
  return { ok: true, removed: removedRows?.length ?? 0, stillMatched };
}

// ── 조회 ────────────────────────────────────────────────────────

export async function listRooms(sb: SupabaseClient, workspaceId: string): Promise<RoomRow[]> {
  const { data, error } = await sb
    .from('kakao_rooms')
    .select(
      'id, room_key, room_name, partner_id, color, pinned_at, handled_at, last_message_at, last_preview, message_count, partners(name, color)',
    )
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[kakao] 방 목록 조회 실패', error.message);
    return [];
  }

  return (data ?? []).map((r) => {
    const partner = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    return {
      id: r.id as string,
      roomKey: r.room_key as string,
      roomName: r.room_name as string,
      partnerId: (r.partner_id as string | null) ?? null,
      partnerName: (partner as { name: string } | null)?.name ?? null,
      color: (r.color as string | null) ?? (partner as { color: string | null } | null)?.color ?? null,
      pinned: !!r.pinned_at,
      handled: !!r.handled_at,
      lastMessageAt: (r.last_message_at as string | null) ?? null,
      preview: (r.last_preview as string | null) ?? '',
      messageCount: (r.message_count as number) ?? 0,
    };
  });
}

export async function listRoomMessages(
  sb: SupabaseClient,
  workspaceId: string,
  roomId: string,
  limit = 300,
): Promise<MessageRow[]> {
  // 최신순으로 잘라낸 뒤 되돌린다. 오름차순으로 자르면 오래 굴러간 방에서 옛 대화 300건만
  // 보이고 정작 방금 온 메시지가 안 뜬다.
  const { data, error } = await sb
    .from('kakao_messages')
    .select('id, speaker, body, side, sent_at, attachment')
    .eq('workspace_id', workspaceId)
    .eq('room_id', roomId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[kakao] 메시지 조회 실패', error.message);
    return [];
  }

  const rows = (data ?? [])
    .map((m) => ({
      id: m.id as string,
      speaker: m.speaker as string,
      body: m.body as string,
      side: (m.side as 'us' | 'partner') ?? 'partner',
      sentAt: m.sent_at as string,
      attachment: (m.attachment as MessageRow['attachment']) ?? null,
    }))
    .reverse();

  await attachSignedUrls(sb, rows);
  return rows;
}

/** 첨부 이미지는 비공개 버킷이라 서명 URL 을 붙여야 <img> 로 뜬다. */
async function attachSignedUrls(sb: SupabaseClient, rows: MessageRow[]) {
  const paths = rows.map((r) => r.attachment?.path).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const { data, error } = await sb.storage
    .from('kakao-attachments')
    .createSignedUrls(paths, 60 * 60);
  if (error || !data) return;

  const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
  for (const row of rows) {
    const path = row.attachment?.path;
    if (path && row.attachment) {
      row.attachment.url = byPath.get(path) ?? undefined;
    }
  }
}

export async function listUnmatchedRooms(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<UnmatchedRoomRow[]> {
  const { data, error } = await sb
    .from('kakao_unmatched_rooms')
    .select('id, room_key, room_name, hit_count, last_seen_at')
    .eq('workspace_id', workspaceId)
    .is('dismissed_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[kakao] 미분류 방 조회 실패', error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    roomKey: r.room_key as string,
    roomName: r.room_name as string,
    hitCount: (r.hit_count as number) ?? 1,
    lastSeenAt: r.last_seen_at as string,
  }));
}
