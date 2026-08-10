'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, getSession } from '@/lib/auth/server';
import { logAudit } from '../audit';
import { BRAND } from '@/lib/brand';
import { sendEmail } from '../email';

async function getOrigin() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host') ?? 'localhost:3001';
  return `${proto}://${host}`;
}

export async function invite(data: { email: string; role: 'admin' | 'viewer' }) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (session.role !== 'owner' && session.role !== 'admin') return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { data: inv, error } = await sb
    .from('invitations')
    .insert({
      workspace_id: session.workspaceId,
      email: data.email,
      role: data.role,
      invited_by: session.userId,
    })
    .select('token')
    .single();

  if (error || !inv) return { error: error?.message ?? '초대 생성 실패' };

  const origin = await getOrigin();
  const inviteUrl = `${origin}/auth/invite?token=${inv.token}`;

  // 워크스페이스 이름 조회 (이메일 본문용)
  let wsName = BRAND.name;
  const { data: ws } = await sb
    .from('workspaces')
    .select('name')
    .eq('id', session.workspaceId)
    .single();
  if (ws?.name) wsName = ws.name;

  const subject = `[${wsName}] 워크스페이스 초대`;
  const html = `
    <p>${wsName} 워크스페이스에 초대되었습니다.</p>
    <p>아래 링크를 통해 7일 이내에 수락해 주세요.</p>
    <p><a href="${inviteUrl}">${inviteUrl}</a></p>
    <p>역할: ${data.role}</p>
  `.trim();
  const text = `${wsName} 워크스페이스 초대\n\n수락 링크: ${inviteUrl}\n역할: ${data.role}`;

  const sendResult = await sendEmail({ to: data.email, subject, html, text });

  await logAudit({
    action: 'member.invite',
    targetTable: 'invitations',
    meta: {
      email: data.email,
      role: data.role,
      emailSent: sendResult.sent,
      emailError: sendResult.error ?? null,
    },
  });

  revalidatePath('/settings/members');
  return { inviteUrl, emailSent: sendResult.sent, emailError: sendResult.error };
}

export async function changeRole(data: { userId: string; role: 'owner' | 'admin' | 'viewer' }) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (session.role !== 'owner' && session.role !== 'admin') return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('memberships')
    .update({ role: data.role })
    .eq('workspace_id', session.workspaceId)
    .eq('user_id', data.userId);

  if (error) return { error: error.message };
  await logAudit({
    action: 'member.role_change',
    targetTable: 'memberships',
    targetId: data.userId,
    meta: { role: data.role },
  });
  revalidatePath('/settings/members');
  return {};
}

export async function removeMember(data: { userId: string }) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (session.role !== 'owner') return { error: 'owner만 제외할 수 있습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('memberships')
    .delete()
    .eq('workspace_id', session.workspaceId)
    .eq('user_id', data.userId);

  if (error) return { error: error.message };
  await logAudit({
    action: 'member.remove',
    targetTable: 'memberships',
    targetId: data.userId,
  });
  revalidatePath('/settings/members');
  return {};
}

export async function cancelInvite(data: { invitationId: string }) {
  const session = await getSession(await cookies());
  if (!session?.workspaceId) return { error: '워크스페이스가 없습니다' };
  if (session.role !== 'owner' && session.role !== 'admin') return { error: '권한이 없습니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { error } = await sb
    .from('invitations')
    .delete()
    .eq('id', data.invitationId)
    .eq('workspace_id', session.workspaceId);

  if (error) return { error: error.message };
  await logAudit({
    action: 'invite.cancel',
    targetTable: 'invitations',
    targetId: data.invitationId,
  });
  revalidatePath('/settings/members');
  return {};
}

export async function acceptInvite(token: string) {
  const session = await getSession(await cookies());
  if (!session) return { error: '로그인이 필요합니다' };

  const sb = createSupabaseServerClient(await cookies());
  const { data: inv, error: invErr } = await sb
    .from('invitations')
    .select('id, workspace_id, role, expires_at, accepted_at, email')
    .eq('token', token)
    .single();

  if (invErr || !inv) return { error: '유효하지 않은 초대 토큰입니다' };
  if (inv.accepted_at) return { error: '이미 사용된 초대입니다' };
  if (new Date(inv.expires_at) < new Date()) return { error: '만료된 초대입니다' };

  const { error: mErr } = await sb.from('memberships').upsert(
    {
      workspace_id: inv.workspace_id,
      user_id: session.userId,
      role: inv.role,
    },
    { onConflict: 'workspace_id,user_id' },
  );
  if (mErr) return { error: mErr.message };

  await sb.from('invitations').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  await sb.from('profiles').update({ current_workspace_id: inv.workspace_id }).eq('id', session.userId);

  await logAudit({
    action: 'invite.accept',
    targetTable: 'invitations',
    targetId: inv.id,
    meta: { workspaceId: inv.workspace_id, role: inv.role },
  });

  return { workspaceId: inv.workspace_id };
}
