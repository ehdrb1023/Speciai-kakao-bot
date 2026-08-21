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
    .select('last_seen_at, last_gap_ms, last_source')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) {
    console.error('[kakao] 봇 심장박동 조회 실패', error.message);
    return null;
  }
  if (!data?.last_seen_at) return null;
  return {
    lastSeenAt: data.last_seen_at as string,
    lastGapMs: (data.last_gap_ms as number | null) ?? null,
    lastSource: (data.last_source as string | null) ?? null,
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
