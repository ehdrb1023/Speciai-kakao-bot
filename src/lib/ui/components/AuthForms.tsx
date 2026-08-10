'use client';

import { useState } from 'react';
import { BRAND } from '../../brand';

interface SignInFormProps {
  /** 카카오 OAuth 액션 — 호출 시 카카오 동의창 URL로 리다이렉트 */
  kakaoAction: () => Promise<{ error?: string; url?: string }>;
}

export function SignInForm({ kakaoAction }: SignInFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <div className="auth-logo">율</div>
        <div>
          <div className="auth-title">{BRAND.name}</div>
          <div className="auth-sub">카카오로 간편 로그인</div>
        </div>
      </div>

      <button
        type="button"
        className="auth-kakao"
        onClick={async () => {
          setErr(null);
          setSubmitting(true);
          try {
            const { error, url } = await kakaoAction();
            if (error) setErr(`카카오 로그인 오류: ${error}`);
            else if (url) window.location.href = url;
            else setErr('카카오 로그인 URL을 받지 못했습니다. Supabase의 카카오 provider 설정을 확인하세요.');
          } catch (e) {
            setErr(`카카오 로그인 예외: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setSubmitting(false);
          }
        }}
        disabled={submitting}
      >
        <span className="auth-kakao-icon">●</span>
        {submitting ? '카카오로 이동 중…' : '카카오로 시작하기'}
      </button>

      {err && <div className="auth-error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}
