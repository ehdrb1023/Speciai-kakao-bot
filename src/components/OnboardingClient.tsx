'use client';

import { useState } from 'react';

interface Props {
  createAction: (data: { name: string; slug: string }) => Promise<{ error?: string }>;
  userEmail: string;
  userName: string;
}

export function OnboardingClient({ createAction, userEmail, userName }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const { error } = await createAction({ name, slug });
    if (error) {
      setErr(error);
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <div className="auth-logo">율</div>
        <div>
          <div className="auth-title">워크스페이스 만들기</div>
          <div className="auth-sub">{userName} ({userEmail})</div>
        </div>
      </div>
      <form onSubmit={submit} className="auth-form">
        <div className="auth-field">
          <label>법인명</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="auth-field">
          <label>식별자 (URL용, 영문 소문자)</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            required
            pattern="[a-z0-9-]+"
          />
        </div>
        {err && <div className="auth-error">{err}</div>}
        <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
          {submitting ? '생성 중...' : '워크스페이스 생성'}
        </button>
      </form>
    </div>
  );
}
