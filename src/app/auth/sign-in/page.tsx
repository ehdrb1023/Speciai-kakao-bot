import { cookies } from 'next/headers';
import { SignInForm } from '@/lib/ui';
import { signInWithKakao, signInWithEmail, signUpWithEmail } from '@/server/actions/auth';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `로그인 · ${BRAND.name}` };

export default async function Page() {
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
    <div className="auth-shell">
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
        />
      </div>
    </div>
  );
}
