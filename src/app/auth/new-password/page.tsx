import { NewPasswordForm } from '@/lib/ui';
import { updatePassword } from '@/server/actions/auth';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `비밀번호 재설정 · ${BRAND.name}` };

// 재설정 메일 링크 → /auth/callback(세션 심음) → 여기.
// 세션이 있어야만 열리는 페이지라 PUBLIC_PATHS 에 넣지 않는다.
// 세션 없이 직접 들어오면 미들웨어가 sign-in 으로 돌려보낸다.
export default function Page() {
  return (
    <div className="tsa auth-shell">
      <div className="auth-hero">
        <div className="auth-hero-kicker">{BRAND.name} · {BRAND.tagline}</div>
        <h1>
          새 비밀번호를
          <br />
          정해 주세요
        </h1>
        <p>
          바꾼 뒤에는 새 비밀번호로만 로그인됩니다.
          <br />
          다른 기기에서도 동일하게 적용됩니다.
        </p>
        <div className="auth-hero-note">{BRAND.name} · 내부 전용</div>
      </div>
      <div className="auth-form-side">
        <NewPasswordForm updateAction={updatePassword} />
      </div>
    </div>
  );
}
