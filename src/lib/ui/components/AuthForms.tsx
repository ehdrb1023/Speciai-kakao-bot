'use client';

import { useState } from 'react';
import { BRAND } from '../../brand';

interface SignInFormProps {
  /** 카카오 OAuth 액션 — 호출 시 카카오 동의창 URL로 리다이렉트 */
  kakaoAction: () => Promise<{ error?: string; url?: string }>;
  /** 이메일·비밀번호 로그인 */
  emailSignInAction: (email: string, password: string) => Promise<{ error?: string; ok?: boolean }>;
  /** 이메일·비밀번호 가입 */
  emailSignUpAction: (
    email: string,
    password: string,
  ) => Promise<{ error?: string; ok?: boolean; needsConfirm?: boolean }>;
}

export function SignInForm({ kakaoAction, emailSignInAction, emailSignUpAction }: SignInFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = submitting;

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);

    if (!email.trim()) return setErr('이메일을 입력해 주세요.');
    // Supabase 기본 정책이 6자 이상이라 서버 왕복 전에 걸러낸다.
    if (password.length < 6) return setErr('비밀번호는 6자 이상이어야 합니다.');

    setSubmitting(true);
    try {
      const res =
        mode === 'signin'
          ? await emailSignInAction(email, password)
          : await emailSignUpAction(email, password);

      if (res.error) {
        setErr(res.error);
        return;
      }
      if (mode === 'signup' && 'needsConfirm' in res && res.needsConfirm) {
        setNotice('가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 인증을 완료해 주세요.');
        return;
      }
      // 세션 쿠키는 서버 액션에서 심겼다. 미들웨어가 워크스페이스 유무를 보고
      // 온보딩/콘솔로 보내주므로 루트로 새로고침한다(router.push 는 캐시된 셸을 재사용한다).
      window.location.href = '/';
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <div className="auth-logo">{BRAND.mark}</div>
        <div>
          <div className="auth-title">{BRAND.name}</div>
          <div className="auth-sub">
            {mode === 'signin' ? '이메일로 로그인' : '이메일로 가입'}
          </div>
        </div>
      </div>

      <form onSubmit={handleEmailSubmit} className="auth-email-form">
        <div className="auth-field">
          <label htmlFor="auth-email">이메일</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            disabled={busy}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="auth-password">비밀번호</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6자 이상"
            disabled={busy}
            required
          />
        </div>

        <button type="submit" className="btn btn-dark auth-submit" disabled={busy}>
          {busy ? '처리 중…' : mode === 'signin' ? '로그인' : '가입하기'}
        </button>
      </form>

      <button
        type="button"
        className="auth-switch"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setErr(null);
          setNotice(null);
        }}
        disabled={busy}
      >
        {mode === 'signin' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있으신가요? 로그인'}
      </button>

      <div className="auth-divider"><span>또는</span></div>

      <button
        type="button"
        className="auth-kakao"
        onClick={async () => {
          setErr(null);
          setNotice(null);
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
        disabled={busy}
      >
        <span className="auth-kakao-icon">●</span>
        {busy ? '이동 중…' : '카카오로 시작하기'}
      </button>

      {notice && <div className="auth-notice" style={{ marginTop: 12 }}>{notice}</div>}
      {err && <div className="auth-error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}
