'use client';

import { useState } from 'react';
import { seoulDate } from '@/lib/time';

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'admin' | 'viewer';
  joinedAt: string;
  isSelf: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  expiresAt: string;
  createdAt: string;
}

interface MembersPanelProps {
  workspaceName: string;
  canManage: boolean;
  members: MemberRow[];
  invitations: InvitationRow[];
  inviteAction: (data: { email: string; role: 'admin' | 'viewer' }) => Promise<{
    error?: string;
    inviteUrl?: string;
    emailSent?: boolean;
    emailError?: string;
  }>;
  changeRoleAction: (data: { userId: string; role: 'owner' | 'admin' | 'viewer' }) => Promise<{ error?: string }>;
  removeMemberAction: (data: { userId: string }) => Promise<{ error?: string }>;
  cancelInviteAction: (data: { invitationId: string }) => Promise<{ error?: string }>;
}

const roleLabel: Record<MemberRow['role'], string> = {
  owner: '대표',
  admin: '관리자',
  viewer: '열람',
};

export function MembersPanel({
  workspaceName,
  canManage,
  members,
  invitations,
  inviteAction,
  changeRoleAction,
  removeMemberAction,
  cancelInviteAction,
}: MembersPanelProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLink(null);
    setSubmitting(true);
    try {
      const r = await inviteAction({ email, role });
      if (r.error) setMsg(r.error);
      else {
        if (r.emailSent) {
          setMsg(`${email}에게 초대 이메일을 발송했습니다`);
        } else if (r.emailError) {
          setMsg(`초대 생성됨 — 이메일 발송 실패: ${r.emailError}. 아래 링크를 직접 전달하세요.`);
        } else {
          setMsg(`초대 생성됨 — 이메일 미설정. 아래 링크를 직접 전달하세요.`);
        }
        if (r.inviteUrl) setLink(r.inviteUrl);
        setEmail('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="members">
      <header className="members-head">
        <div>
          <h1 className="members-title">멤버 관리</h1>
          <p className="members-sub">{workspaceName} · 함께 볼 담당자 초대</p>
        </div>
      </header>

      {canManage && (
        <section className="members-section">
          <div className="members-section-title">새 멤버 초대</div>
          <form className="invite-form" onSubmit={submitInvite}>
            <input
              type="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
              <option value="admin">관리자</option>
              <option value="viewer">열람</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? '발송 중...' : '초대 보내기'}
            </button>
          </form>
          {msg && <div className="invite-msg">{msg}</div>}
          {link && (
            <div className="invite-link">
              <div className="invite-link-label">초대 링크 (개발 환경 — 직접 공유 가능)</div>
              <code>{link}</code>
            </div>
          )}
        </section>
      )}

      <section className="members-section">
        <div className="members-section-title">활성 멤버 ({members.length}명)</div>
        <div className="members-list">
          {members.map((m) => (
            <div key={m.userId} className="member-row">
              <div className="member-avatar">{(m.displayName || m.email).slice(0, 1).toUpperCase()}</div>
              <div className="member-body">
                <div className="member-name">
                  {m.displayName || m.email.split('@')[0]}
                  {m.isSelf && <span className="member-self">나</span>}
                </div>
                <div className="member-email">{m.email}</div>
              </div>
              {canManage && !m.isSelf && m.role !== 'owner' ? (
                <select
                  value={m.role}
                  onChange={(e) =>
                    changeRoleAction({ userId: m.userId, role: e.target.value as 'admin' | 'viewer' })
                  }
                  className="member-role-sel"
                >
                  <option value="admin">관리자</option>
                  <option value="viewer">열람</option>
                </select>
              ) : (
                <span className={`chip chip-${m.role === 'owner' ? 'blue' : 'gray'}`}>{roleLabel[m.role]}</span>
              )}
              {canManage && !m.isSelf && m.role !== 'owner' && (
                <button
                  className="member-remove"
                  onClick={() => {
                    if (confirm(`${m.email}을 워크스페이스에서 제외할까요?`)) {
                      removeMemberAction({ userId: m.userId });
                    }
                  }}
                >
                  제외
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {invitations.length > 0 && (
        <section className="members-section">
          <div className="members-section-title">대기 중인 초대 ({invitations.length}건)</div>
          <div className="members-list">
            {invitations.map((inv) => (
              <div key={inv.id} className="member-row">
                <div className="member-avatar member-avatar-pending">?</div>
                <div className="member-body">
                  <div className="member-name">{inv.email}</div>
                  <div className="member-email">
                    {roleLabel[inv.role]} 권한 · {seoulDate(inv.expiresAt)} 만료
                  </div>
                </div>
                {canManage && (
                  <button
                    className="member-remove"
                    onClick={() => cancelInviteAction({ invitationId: inv.id })}
                  >
                    취소
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
