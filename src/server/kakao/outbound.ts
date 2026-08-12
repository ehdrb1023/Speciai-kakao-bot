import type { SupabaseClient } from '@supabase/supabase-js';

// 대시보드 → 카톡방 발신.
//
// 서버는 카톡에 직접 말할 수 없다. 봇 단말만이 알림 세션으로 방에 글을 넣는다.
// 그래서 여기 있는 것은 전부 "큐" 다 — 적어두고(queue), 봇이 가져가고(claim),
// 결과를 되돌려받는다(ack). 사람에게는 그 상태가 그대로 보여야 한다.

export type OutboundStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface OutboundRow {
  id: string;
  roomId: string;
  body: string;
  authorName: string;
  status: OutboundStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** 봇에게 내려보내는 1건. room 은 방 제목 — 봇의 전송 API 가 방 제목으로 세션을 찾는다. */
export interface OutboundJob {
  id: string;
  room: string;
  text: string;
}

/** 3번 실패하면 접는다. 계속 두드려봐야 알림 세션이 없는 것이고, 그 사실을 사람이 알아야 한다. */
export const OUTBOUND_MAX_ATTEMPTS = 3;

/** 봇이 가져간 뒤 이 시간 안에 결과가 없으면 폰이 죽은 것으로 보고 되살린다. */
const CLAIM_LEASE_MS = 2 * 60 * 1000;

export const OUTBOUND_MAX_LENGTH = 2000;

/**
 * 실제로 카톡에 나갈 문자열.
 *
 * 발신은 봇 폰의 카카오 계정 하나로 나간다. 접두가 없으면 거래처 화면에서는 여러 담당자의
 * 답이 전부 같은 낯선 계정 한 명이 말한 것으로 보인다. 그래서 이름을 붙인다.
 * 이름에 대괄호가 들어가면 접두가 어디서 끝나는지 알 수 없게 되므로 지운다.
 */
export function composeWireText(authorName: string, body: string): string {
  const name = authorName.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  const text = body.trim();
  if (!name) return text;
  return `[${name}] ${text}`;
}

function mapRow(r: Record<string, unknown>): OutboundRow {
  return {
    id: r.id as string,
    roomId: r.room_id as string,
    body: r.body as string,
    authorName: r.author_name as string,
    status: r.status as OutboundStatus,
    attempts: (r.attempts as number) ?? 0,
    error: (r.last_error as string | null) ?? null,
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string | null) ?? null,
  };
}

export async function queueOutbound(
  sb: SupabaseClient,
  input: {
    workspaceId: string;
    roomId: string;
    body: string;
    authorName: string;
    authorId: string | null;
  },
): Promise<{ ok: boolean; row?: OutboundRow; error?: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: '보낼 내용이 비어 있습니다' };
  if (body.length > OUTBOUND_MAX_LENGTH) {
    return { ok: false, error: `${OUTBOUND_MAX_LENGTH}자를 넘습니다` };
  }

  const { data, error } = await sb
    .from('kakao_outbound')
    .insert({
      workspace_id: input.workspaceId,
      room_id: input.roomId,
      body,
      author_name: input.authorName,
      author_id: input.authorId,
    })
    .select('id, room_id, body, author_name, status, attempts, last_error, created_at, sent_at')
    .maybeSingle();

  if (error || !data) {
    console.error('[kakao] 발신 큐 적재 실패', error?.message);
    return { ok: false, error: error?.message ?? '큐 적재 실패' };
  }
  return { ok: true, row: mapRow(data) };
}

/**
 * 봇이 가져갈 것을 뽑아 sending 으로 잠근다.
 *
 * roomId 를 주면 그 방 것만 — 인입 응답에 얹어 보낼 때 쓴다. 거래처가 방금 말한 직후라
 * 그 방의 알림 세션이 가장 확실히 살아 있는 순간이고, 그때 같이 내보내면 성공률이 높다.
 */
export async function claimOutbound(
  sb: SupabaseClient,
  workspaceId: string,
  opts: { roomId?: string; limit?: number } = {},
): Promise<OutboundJob[]> {
  const limit = opts.limit ?? 10;

  await reclaimStale(sb, workspaceId);

  let q = sb
    .from('kakao_outbound')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (opts.roomId) q = q.eq('room_id', opts.roomId);

  const { data: candidates, error: selErr } = await q;
  if (selErr) {
    console.error('[kakao] 발신 대기 조회 실패', selErr.message);
    return [];
  }
  const ids = (candidates ?? []).map((r) => r.id as string);
  if (ids.length === 0) return [];

  // status='pending' 조건을 걸어둔다. 다른 요청이 먼저 집어갔으면 그 행은 갱신되지 않고
  // 반환에서도 빠져 두 번 나가지 않는다.
  const { data, error } = await sb
    .from('kakao_outbound')
    .update({
      status: 'sending',
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('status', 'pending')
    .select('id, room_id, body, author_name');

  if (error) {
    console.error('[kakao] 발신 클레임 실패', error.message);
    return [];
  }
  const claimed = data ?? [];
  if (claimed.length === 0) return [];

  // 봇에게 내려보낼 방 이름을 따로 읽는다. 없으면 보낼 수 없다 — 조인 한 번을 아끼려다
  // 이 값이 비면 조용히 아무것도 안 나간다.
  //
  // ⚠️ 여기서 내려보내는 것은 **화면에 보이는 이름이 아니라 규칙 pattern** 이다.
  // 봇은 받은 방 이름을 자기 규칙 목록과 대조해서 "규칙에 없는 방에는 안 쓴다" 를 한 번 더
  // 검사한다(개인 카톡방에 글이 써지는 것을 막는 마지막 방어선). 그런데 room_name 은
  // 사람이 읽을 이름(거래처명)으로 갈아 끼워져 있어서 규칙에 걸리지 않는다.
  // 실측 2026-08-12: room_name 을 내려보냈더니 단말이 전부 "규칙에 없는 방" 으로 거부했다.
  const roomIds = [...new Set(claimed.map((r) => r.room_id as string))];
  const { data: rooms, error: roomErr } = await sb
    .from('kakao_rooms')
    .select('id, room_name, matched_rule_id, partner_room_rules(pattern)')
    .in('id', roomIds);
  if (roomErr) {
    console.error('[kakao] 발신 방 이름 조회 실패', roomErr.message);
    return [];
  }
  const wireNameById = new Map(
    (rooms ?? []).map((r) => {
      const rule = Array.isArray(r.partner_room_rules) ? r.partner_room_rules[0] : r.partner_room_rules;
      const pattern = (rule as { pattern: string } | null)?.pattern;
      // 규칙이 지워진 방(#등록해제 뒤 남은 행)은 어차피 단말이 거부한다. 이름으로 폴백해
      // 실패가 로그에 남게 두는 편이 조용히 사라지는 것보다 낫다.
      return [r.id as string, pattern ?? (r.room_name as string)];
    }),
  );

  return claimed
    .map((r) => ({
      id: r.id as string,
      room: wireNameById.get(r.room_id as string) ?? '',
      text: composeWireText(r.author_name as string, r.body as string),
    }))
    .filter((j) => !!j.room);
}

/** 폰이 도중에 죽어 sending 으로 남은 것을 되살린다. 안 하면 그 메시지는 영원히 안 나간다. */
async function reclaimStale(sb: SupabaseClient, workspaceId: string) {
  const cutoff = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const { error } = await sb
    .from('kakao_outbound')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('status', 'sending')
    .lt('claimed_at', cutoff);
  if (error) console.error('[kakao] 발신 리스 회수 실패', error.message);
}

export interface OutboundAck {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * 봇이 알려준 전송 결과를 반영한다.
 *
 * 성공하면 같은 내용을 kakao_messages 에 side='us' 로 남긴다. 봇 폰이 스스로 보낸 메시지는
 * 그 폰에 알림이 뜨지 않아 수집 경로로 절대 돌아오지 않는다 — 여기서 안 남기면 대화 기록에
 * 우리가 한 말만 빠진 채로 남는다.
 */
export async function ackOutbound(
  sb: SupabaseClient,
  workspaceId: string,
  acks: OutboundAck[],
): Promise<{ sent: number; failed: number; retry: number }> {
  let sent = 0;
  let failed = 0;
  let retry = 0;

  for (const ack of acks) {
    const { data: row, error } = await sb
      .from('kakao_outbound')
      .select('id, room_id, body, author_name, attempts, status')
      .eq('workspace_id', workspaceId)
      .eq('id', ack.id)
      .maybeSingle();
    if (error || !row) {
      console.error('[kakao] 발신 결과 대상 없음', ack.id, error?.message);
      continue;
    }
    // 이미 결론난 건에 대한 중복 ack(봇 재전송)는 무시한다. sent 를 failed 로 뒤집으면 안 된다.
    if (row.status !== 'sending') continue;

    const now = new Date().toISOString();
    const attempts = ((row.attempts as number) ?? 0) + 1;

    if (ack.ok) {
      await sb
        .from('kakao_outbound')
        .update({ status: 'sent', sent_at: now, attempts, last_error: null, updated_at: now })
        .eq('id', row.id as string);
      await recordSentMessage(sb, workspaceId, {
        id: row.id as string,
        roomId: row.room_id as string,
        speaker: row.author_name as string,
        body: row.body as string,
        sentAt: now,
      });
      sent++;
      continue;
    }

    const giveUp = attempts >= OUTBOUND_MAX_ATTEMPTS;
    await sb
      .from('kakao_outbound')
      .update({
        status: giveUp ? 'failed' : 'pending',
        attempts,
        last_error: (ack.error ?? '전송 실패').slice(0, 300),
        updated_at: now,
      })
      .eq('id', row.id as string);
    if (giveUp) failed++;
    else retry++;
  }

  return { sent, failed, retry };
}

async function recordSentMessage(
  sb: SupabaseClient,
  workspaceId: string,
  input: { id: string; roomId: string; speaker: string; body: string; sentAt: string },
) {
  const { error } = await sb.from('kakao_messages').upsert(
    {
      workspace_id: workspaceId,
      room_id: input.roomId,
      speaker: input.speaker,
      body: input.body,
      side: 'us',
      // 발신 id 를 그대로 멱등 키로 쓴다. 봇이 결과를 두 번 알려도 대화에 두 번 남지 않는다.
      content_hash: `out:${input.id}`,
      sent_at: input.sentAt,
    },
    { onConflict: 'room_id,content_hash', ignoreDuplicates: true },
  );
  if (error) {
    console.error('[kakao] 발신 메시지 기록 실패', error.message);
    return;
  }

  const { count } = await sb
    .from('kakao_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', input.roomId);

  // handled_at·deleted_at 은 건드리지 않는다. 답장은 처리한 행위지 새 용건이 아니다 —
  // 여기서 되살리면 처리완료로 내린 방이 답장할 때마다 목록에 다시 올라온다.
  const { error: roomErr } = await sb
    .from('kakao_rooms')
    .update({
      last_message_at: input.sentAt,
      last_preview: input.body.slice(0, 200),
      message_count: count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.roomId);
  if (roomErr) console.error('[kakao] 발신 후 방 갱신 실패', roomErr.message);
}

/**
 * 대화창에 겹쳐 보여줄 발신 건 — 아직 안 나갔거나 실패한 것만.
 * sent 는 kakao_messages 로 복사돼 있으므로 여기서 또 주면 화면에 두 번 뜬다.
 */
export async function listRoomOutbound(
  sb: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<OutboundRow[]> {
  const { data, error } = await sb
    .from('kakao_outbound')
    .select('id, room_id, body, author_name, status, attempts, last_error, created_at, sent_at')
    .eq('workspace_id', workspaceId)
    .eq('room_id', roomId)
    .in('status', ['pending', 'sending', 'failed'])
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[kakao] 발신 목록 조회 실패', error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** 아직 안 나간 것 취소. 이미 봇이 집어간(sending) 것은 되돌릴 수 없다. */
export async function cancelOutbound(
  sb: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb
    .from('kakao_outbound')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .in('status', ['pending', 'failed'])
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: '이미 전송 중이라 취소할 수 없습니다' };
  return { ok: true };
}
