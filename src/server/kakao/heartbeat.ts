import type { SupabaseClient } from '@supabase/supabase-js';

// 봇 단말 생존 신호. 봇이 서버를 두드릴 때마다 시각을 찍고, 콘솔이 그걸 읽어 판정한다.
//
// 이 파일이 있는 이유는 "조용히 죽는 것" 을 막기 위해서다. 봇이 멈춰도 서버는 멀쩡하고
// 화면도 멀쩡해서, 사람이 "요즘 카톡이 안 들어오네" 라고 느낄 때까지 아무도 모른다.
// 실제로 그렇게 하루를 날렸다(2026-08-17, 삼성 절전이 메신저봇R 을 재웠다).

/** 봇이 서버를 두드린 경로. 어느 쪽이든 "앱이 살아서 돌고 있다" 는 뜻은 같다. */
export type HeartbeatSource = 'outbox' | 'ingest' | 'rules';

export interface BotHeartbeat {
  lastSeenAt: string;
  /** 직전 두드림과의 간격(ms). 첫 기록이면 null. */
  lastGapMs: number | null;
  lastSource: string | null;
  /**
   * 봇이 지금 답장 통로를 들고 있는 방들. **규칙 pattern** 이지 화면에 보이는 이름이 아니다
   * (claimOutbound 가 내려보내는 값과 같은 것).
   * null 이면 "봇이 아직 이 목록을 올린 적 없다" — 못 보낸다는 뜻이 아니다.
   */
  sendableRooms: string[] | null;
  /** 그 목록을 마지막으로 받은 시각. 오래됐으면 목록을 믿지 않는다. */
  sendableAt: string | null;
}

/**
 * 봇이 살아 있다고 표시한다. 실패해도 본 작업을 막지 않는다 —
 * 심장박동을 못 적었다고 메시지 수집이나 발신이 멈추면 배보다 배꼽이 크다.
 *
 * 매 폴링(1분)마다 1행 update 다. 쓰기 비용을 아끼려고 5분에 한 번만 찍는 안도 있었지만,
 * 그러면 간격 측정이 뭉개져 "재워짐" 과 "죽음" 을 못 가른다. 그게 이 기능의 전부라
 * 아끼지 않는다. 서버리스 호출은 어차피 봇이 이미 하고 있고, 늘어나는 것은 단일 행
 * upsert 하나뿐이다.
 */
export async function touchBotHeartbeat(
  sb: SupabaseClient,
  workspaceId: string,
  source: HeartbeatSource,
  /**
   * 봇이 같이 실어 보낸 "지금 보낼 수 있는 방" 목록(규칙 pattern).
   * outbox 폴링에만 실려 온다. **undefined 면 손대지 않는다** — ingest·rules 로 들어온
   * 심장박동이 outbox 가 올려둔 목록을 빈 값으로 덮으면, 멀쩡한 방이 1분씩 "닫힘" 으로
   * 깜빡인다.
   */
  sendableRooms?: string[],
): Promise<void> {
  try {
    const now = new Date();
    const { data: prev } = await sb
      .from('kakao_bot_status')
      .select('last_seen_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const prevAt = prev?.last_seen_at ? new Date(prev.last_seen_at as string) : null;
    const gapMs =
      prevAt && !Number.isNaN(prevAt.getTime()) ? Math.max(0, now.getTime() - prevAt.getTime()) : null;

    const { error } = await sb.from('kakao_bot_status').upsert(
      {
        workspace_id: workspaceId,
        last_seen_at: now.toISOString(),
        last_gap_ms: gapMs,
        last_source: source,
        updated_at: now.toISOString(),
        ...(sendableRooms
          ? { sendable_rooms: sendableRooms, sendable_at: now.toISOString() }
          : {}),
      },
      { onConflict: 'workspace_id' },
    );
    if (error) console.error('[kakao] 봇 심장박동 기록 실패', error.message);
  } catch (e) {
    console.error('[kakao] 봇 심장박동 예외', e);
  }
}

export async function loadBotHeartbeat(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<BotHeartbeat | null> {
  const { data, error } = await sb
    .from('kakao_bot_status')
    .select('last_seen_at, last_gap_ms, last_source, sendable_rooms, sendable_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) {
    console.error('[kakao] 봇 심장박동 조회 실패', error.message);
    return null;
  }
  if (!data?.last_seen_at) return null;
  const rooms = data.sendable_rooms;
  return {
    lastSeenAt: data.last_seen_at as string,
    lastGapMs: (data.last_gap_ms as number | null) ?? null,
    lastSource: (data.last_source as string | null) ?? null,
    sendableRooms: Array.isArray(rooms) ? rooms.filter((v): v is string => typeof v === 'string') : null,
    sendableAt: (data.sendable_at as string | null) ?? null,
  };
}

/**
 * 봇 상태 판정.
 *
 *   unknown  신호를 한 번도 못 받았다(이 기능 배포 직후이거나, 봇이 아직 안 붙었다)
 *   ok       정상. 폴링 주기 안에 들어왔다
 *   delayed  살아는 있는데 늦다 — 안드로이드 Doze 로 재워진 모양이다.
 *            알림이 오면 폰이 깨어나므로 수집 자체는 대개 계속된다.
 *   down     끊겼다. 앱이 죽었거나 폰이 재부팅됐다. 사람이 폰을 봐야 한다.
 *
 * 경계값의 근거: 봇의 폴링 주기는 활동 중 15초, 조용할 때 60초다(OUTBOX_IDLE_POLL_MS).
 * 네트워크가 잠깐 끊기거나 함수 콜드스타트로 한두 번 건너뛰는 것은 정상이므로 3분까지는
 * ok 로 본다. 30분은 Doze 유지 구간(보통 최대 십수 분)보다 넉넉히 잡은 값이다 —
 * 여기까지 왔으면 재워진 것이 아니라 죽은 것이다.
 */
export const HEARTBEAT_OK_MS = 3 * 60 * 1000;
export const HEARTBEAT_DOWN_MS = 30 * 60 * 1000;

export type BotLiveness = 'unknown' | 'ok' | 'delayed' | 'down';

export function botLivenessOf(lastSeenAt: string | null, now: Date = new Date()): BotLiveness {
  if (!lastSeenAt) return 'unknown';
  const at = new Date(lastSeenAt);
  if (Number.isNaN(at.getTime())) return 'unknown';
  // 폰 시계가 앞서 있으면 음수가 나온다. 미래의 신호도 "방금 받았다" 로 본다.
  const silentMs = Math.max(0, now.getTime() - at.getTime());
  if (silentMs >= HEARTBEAT_DOWN_MS) return 'down';
  if (silentMs >= HEARTBEAT_OK_MS) return 'delayed';
  return 'ok';
}

// ── 이 방으로 지금 보낼 수 있나 ─────────────────────────────────
//
// 서버는 카톡에 직접 말할 수 없다. 실제로 글을 넣는 것은 봇 단말이 들고 있는 알림 답장
// 통로뿐이고, 그 통로는 **그 방 알림이 한 번 와야** 열린다. 앱이 죽거나 폰이 재부팅되면
// 전멸한다(PendingIntent 는 프로세스 토큰이라 원리상 되살릴 수 없다).
//
// 그래서 조용한 방에 대시보드로 글을 쓰면 9초 만에 3회 실패로 죽는다(OUTBOUND_MAX_ATTEMPTS).
// 사람은 "보내기" 를 누르기 전까지 그걸 알 방법이 없었다. 봇은 알고 있었는데 아무도
// 안 물어봤을 뿐이다 — 그 목록을 심장박동에 얹어 화면이 **쓰기 전에** 말해주게 한다.

/**
 * 통로 목록의 유효기한.
 *
 * 봇의 조용할 때 폴링 주기가 60초(OUTBOX_IDLE_POLL_MS)다. 콜드스타트·네트워크로 몇 번
 * 건너뛰는 것은 정상이므로 넉넉히 5분을 준다. 이걸 넘기면 목록이 낡은 것이고, 그때는
 * "닫혔다" 가 아니라 **"모른다"** 로 간다 — 봇이 죽었거나 목록을 안 올리는 구버전
 * 스크립트일 뿐인데 멀쩡한 방에 "못 보냅니다" 를 띄우면 그게 거짓 경보다.
 */
export const SENDABLE_STALE_MS = 5 * 60 * 1000;

/**
 *   open     통로가 열려 있다. 지금 쓰면 나간다
 *   closed   봇은 목록을 올리고 있는데 이 방이 그 안에 없다. 지금 쓰면 실패한다
 *   unknown  판단 근거가 없다. 경고하지 않는다(거짓 경보를 만들지 않는다)
 */
export type RoomSendState = 'open' | 'closed' | 'unknown';

/** 봇이 아는 방 이름(규칙 pattern)끼리 맞춘다. ruleMatches 와 같이 대소문자만 무시한다. */
function sameRoomName(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * roomPattern 은 그 방의 규칙 pattern 이다 — **화면에 보이는 이름이 아니다.**
 * 봇이 통로를 걸어두는 열쇠도, claimOutbound 가 내려보내는 이름도 그쪽이다.
 * room_name 은 거래처명으로 갈아 끼워져 있어 여기 쓰면 전부 closed 로 나온다.
 */
export function roomSendStateOf(
  hb: BotHeartbeat | null,
  roomPattern: string | null,
  now: Date = new Date(),
): RoomSendState {
  if (!hb?.sendableAt || !hb.sendableRooms) return 'unknown';
  const at = new Date(hb.sendableAt);
  if (Number.isNaN(at.getTime())) return 'unknown';
  if (Math.max(0, now.getTime() - at.getTime()) >= SENDABLE_STALE_MS) return 'unknown';
  // 규칙이 지워진 방(#등록해제 뒤 남은 행). 어차피 단말이 거부하지만, 그 사유는 통로가
  // 아니라 연결이 끊긴 것이므로 여기서 단정하지 않는다.
  if (!roomPattern) return 'unknown';
  return hb.sendableRooms.some((p) => sameRoomName(p, roomPattern)) ? 'open' : 'closed';
}

/** 그 방의 규칙 pattern. 봇에게 내려보내는 이름과 같은 값을 같은 경로로 읽는다. */
export async function loadRoomPattern(
  sb: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('kakao_rooms')
    .select('id, partner_room_rules(pattern)')
    .eq('workspace_id', workspaceId)
    .eq('id', roomId)
    .maybeSingle();
  if (error) {
    console.error('[kakao] 방 규칙 pattern 조회 실패', error.message);
    return null;
  }
  const rel = Array.isArray(data?.partner_room_rules)
    ? data?.partner_room_rules[0]
    : data?.partner_room_rules;
  return (rel as { pattern: string } | null)?.pattern ?? null;
}
