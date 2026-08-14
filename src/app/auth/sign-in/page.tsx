import { cookies } from 'next/headers';
import { SignInForm } from '@/lib/ui';
import {
  signInWithKakao,
  signInWithEmail,
  signUpWithEmail,
  requestPasswordReset,
} from '@/server/actions/auth';
import { BRAND } from '@/lib/brand';
import { SIGNUP_POLICY_NOTICE } from '@/lib/auth/signup-policy';

export const metadata = { title: `로그인 · ${BRAND.name}` };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // 콜백이 실패하면 여기로 되돌아온다. 가입 도메인 훅에 걸린 경우도 이 경로라, 아무 말 없이
  // 로그인 화면만 다시 뜨면 사람은 자기가 뭘 잘못했는지 알 수 없다.
  //
  // 실패 사유 원문(error_description)은 화면에 싣지 않는다. 주소창으로 들어오는 값이라
  // 링크 하나로 "계정이 정지되었습니다. 010-…로 연락하세요" 같은 문구를 우리 로그인
  // 화면에 띄울 수 있다. 고정 문구만 보여준다.
  const { error: callbackError } = await searchParams;
  // 사용자가 stale 쿠키로 진입해 431이 뜨는 경우 대비:
  // sign-in 진입 시 만료된 sb-* auth chunk 쿠키를 정리한다. 유효 세션이면 미들웨어가 루트로 보냄.
  const cookieStore = await cookies();
  for (const c of cookieStore.getAll()) {
    if (/^sb-.*-auth-token\.\d+$/.test(c.name)) {
      try {
        cookieStore.delete(c.name);
      } catch {
        // 서버 컴포넌트 set 제한 시 무시
      }
    }
  }
  return (
    <div className="tsa auth-shell">
      <div className="auth-hero">
        <div className="auth-hero-kicker">{BRAND.name} · {BRAND.tagline}</div>
        <h1>
          거래처 카톡을
          <br />
          한 곳에서
        </h1>
        <p>
          개인 카톡에 섞여 묻히던 거래처 단톡방 대화를
          <br />
          거래처별로 모아 처리 상태까지 관리합니다.
        </p>
        <div className="auth-hero-note">{BRAND.name} · 내부 전용</div>
      </div>
      <div className="auth-form-side">
        <SignInForm
          kakaoAction={signInWithKakao}
          emailSignInAction={signInWithEmail}
          emailSignUpAction={signUpWithEmail}
          passwordResetAction={requestPasswordReset}
          signUpNotice={SIGNUP_POLICY_NOTICE}
          initialError={
            callbackError
              ? `로그인을 끝내지 못했습니다. ${SIGNUP_POLICY_NOTICE} 회사 메일로 다시 시도해 주세요.`
              : undefined
          }
        />
      </div>
    </div>
  );
}
