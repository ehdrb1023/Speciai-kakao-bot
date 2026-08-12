'use client';

import { useState } from 'react';
import { BRAND } from '../../brand';

type Mode = 'signin' | 'signup' | 'reset';

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
  /** 비밀번호 재설정 메일 발송 */
  passwordResetAction: (email: string) => Promise<{ error?: string; ok?: boolean }>;
}

export function SignInForm({
  kakaoAction,
  emailSignInAction,
  emailSignUpAction,
  passwordResetAction,
}: SignInFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = submitting;

  function switchMode(next: Mode) {
    setMode(next);
    setErr(null);
    setNotice(null);
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);

    if (!email.trim()) return setErr('이메일을 입력해 주세요.');
    // Supabase 기본 정책이 6자 이상이라 서버 왕복 전에 걸러낸다.
    if (mode !== 'reset' && password.length < 6) {
      return setErr('비밀번호는 6자 이상이어야 합니다.');
    }

    setSubmitting(true);
    try {
      if (mode === 'reset') {
        const res = await passwordResetAction(email);
        if (res.error) {
          setErr(res.error);
          return;
        }
        // 가입 여부를 알려주지 않는 문구 — 서버도 같은 이유로 성공만 돌려준다.
        setNotice(
          '가입된 이메일이라면 재설정 메일을 보냈습니다. 메일의 링크를 눌러 새 비밀번호를 정해 주세요.',
        );
        return;
      }

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
            {mode === 'signin'
              ? '이메일로 로그인'
              : mode === 'signup'
                ? '이메일로 가입'
                : '비밀번호 재설정'}
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

        {mode !== 'reset' && (
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
        )}

        <button type="submit" className="btn btn-dark auth-submit" disabled={busy}>
          {busy
            ? '처리 중…'
            : mode === 'signin'
              ? '로그인'
              : mode === 'signup'
                ? '가입하기'
                : '재설정 메일 보내기'}
        </button>
      </form>

      {mode === 'reset' ? (
        <button type="button" className="auth-switch" onClick={() => switchMode('signin')} disabled={busy}>
          로그인으로 돌아가기
        </button>
      ) : (
        <div className="auth-links">
          <button
            type="button"
            className="auth-switch"
            onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
            disabled={busy}
          >
            {mode === 'signin' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있으신가요? 로그인'}
          </button>
          {mode === 'signin' && (
            <button type="button" className="auth-switch" onClick={() => switchMode('reset')} disabled={busy}>
              비밀번호를 잊으셨나요?
            </button>
          )}
        </div>
      )}

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

/**
 * 재설정 메일 링크로 들어온 사용자가 새 비밀번호를 정하는 폼.
 * 이 화면에 도달했다는 건 콜백에서 세션이 이미 심겼다는 뜻이다.
 */
export function NewPasswordForm({
  updateAction,
}: {
  updateAction: (password: string) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (password.length < 6) return setErr('비밀번호는 6자 이상이어야 합니다.');
    if (password !== confirm) return setErr('두 비밀번호가 서로 다릅니다.');

    setSubmitting(true);
    try {
      const res = await updateAction(password);
      if (res.error) {
        setErr(res.error);
        return;
      }
      setDone(true);
      // 비밀번호가 바뀐 세션 그대로 콘솔로 들여보낸다.
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
          <div className="auth-sub">새 비밀번호 설정</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="auth-email-form">
        <div className="auth-field">
          <label htmlFor="new-password">새 비밀번호</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6자 이상"
            disabled={submitting || done}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="new-password-confirm">새 비밀번호 확인</label>
          <input
            id="new-password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="한 번 더 입력"
            disabled={submitting || done}
            required
          />
        </div>

        <button type="submit" className="btn btn-dark auth-submit" disabled={submitting || done}>
          {done ? '이동 중…' : submitting ? '저장 중…' : '비밀번호 변경'}
        </button>
      </form>

      {done && (
        <div className="auth-notice" style={{ marginTop: 12 }}>
          비밀번호를 바꿨습니다. 콘솔로 이동합니다.
        </div>
      )}
      {err && <div className="auth-error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}
