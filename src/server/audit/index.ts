// FR-10.4 감사 로그 — 주요 행위(생성·수정·삭제·다운로드·열람) 기록
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { getServerClient } from '@/lib/db';

export type AuditAction =
  | 'workspace.create'
  | 'workspace.update'
  | 'workspace.switch'
  | 'partner.create'
  | 'partner.update'
  | 'partner.delete'
  | 'partner.room.link'
  | 'partner.room.unlink'
  | 'kakao.bot.ingest'
  | 'kakao.bot.outbox'
  | 'kakao.outbound.queue'
  | 'kakao.outbound.cancel'
  | 'kakao.room.state'
  | 'kakao.room.delete'
  | 'kakao.room.restore'
  | 'member.invite'
  | 'member.role_change'
  | 'member.remove'
  | 'invite.cancel'
  | 'invite.accept';

export async function logAudit(params: {
  action: AuditAction;
  targetTable?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const cookieStore = await cookies();
    const session = await getSession(cookieStore);
    if (!session) return;
    const sb = createSupabaseServerClient(cookieStore);
    await sb.from('audit_logs').insert({
      actor_id: session.userId,
      action: params.action,
      target_table: params.targetTable ?? null,
      target_id: params.targetId ?? null,
      meta: params.meta ?? null,
    });
  } catch {
    // 감사 로그 실패가 본 작업을 중단시키면 안 됨 — 사일런트
  }
}

// 머신(세션 없는 데몬·웹훅) 행위용 감사 로그 — service-role 로 actor 없이 기록.
export async function logAuditMachine(params: {
  action: AuditAction;
  targetTable?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const sb = getServerClient();
    await sb.from('audit_logs').insert({
      actor_id: null,
      action: params.action,
      target_table: params.targetTable ?? null,
      target_id: params.targetId ?? null,
      meta: { ...(params.meta ?? {}), via: 'machine' },
    });
  } catch {
    // 사일런트
  }
}
