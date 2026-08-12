'use client';

import { useState } from 'react';
import { BRAND } from '@/lib/brand';

// 가입 직후 화면. 물어보는 것이 없다 — 워크스페이스는 사내에 하나뿐이고, 이름·식별자는
// 서버가 만든다(createWorkspace 주석 참고). 거래처는 여기가 아니라 대시보드에서 등록하고,
// 방 연결은 카톡방에서 "#등록 <회사명>" 으로 한다.

interface Props {
  createAction: () => Promise<{ error?: string }>;
  userEmail: string;
  userName: string;
}

export function OnboardingClient({ createAction, userEmail, userName }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const { error } = await createAction();
    if (error) {
      setErr(error);
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <div className="auth-logo">{BRAND.mark}</div>
        <div>
          <div className="auth-title">시작하기</div>
          <div className="auth-sub">{userName} ({userEmail})</div>
        </div>
      </div>
      <form onSubmit={submit} className="auth-form">
        <p className="auth-note">
          거래처는 들어간 뒤 등록하고, 방 연결은 카톡방에서 <b>#등록 &lt;회사명&gt;</b> 으로 합니다.
        </p>
        {err && <div className="auth-error">{err}</div>}
        <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
          {submitting ? '준비 중...' : '콘솔 들어가기'}
        </button>
      </form>
    </div>
  );
}
