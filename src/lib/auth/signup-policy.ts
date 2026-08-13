/**
 * 가입 가능한 이메일 판정.
 *
 * 이 콘솔은 사내 전용이고 거래처 대화가 통째로 들어 있다. 로그인 화면은 공개 URL 이라
 * 주소만 알면 누구나 계정을 만들 수 있었다 — RLS 가 남의 워크스페이스를 가려주긴 하지만,
 * 모르는 사람이 계정을 만들고 워크스페이스를 만드는 것 자체를 막을 이유가 충분하다.
 *
 * ⚠️ 같은 판정이 두 곳에 있다 (rules.ts ↔ 봇과 같은 구조다)
 *
 * | 앱 | Supabase |
 * |---|---|
 * | 이 파일의 `isAllowedSignupEmail` | `0004_signup_domain.sql` 의 `hook_restrict_signup_by_email_domain` |
 *
 * 앱 쪽은 **안내용**이다. 브라우저에 anon 키가 실려 있어 Supabase Auth API 를 직접 부르면
 * 이 검사를 지나칠 수 있다. 실제로 막는 것은 DB 훅이다. 그래도 앱에서 한 번 더 보는 이유는
 * 훅이 돌려주는 403 이 영문 한 줄이라, 오타 하나로 막힌 팀원이 이유를 알 수 없기 때문이다.
 * 목록을 바꿀 때는 반드시 두 곳을 함께 고칠 것.
 */

/** 이 도메인 메일이면 가입할 수 있다. */
export const ALLOWED_SIGNUP_DOMAINS = ['speciai.ai.kr'];

/**
 * 도메인 밖이지만 예외로 허용하는 주소.
 *
 * 대표 계정이 회사 도메인이 아니다. 지금 있는 계정은 훅의 영향을 받지 않지만(훅은 "가입"
 * 시점에만 돈다), 계정을 다시 만들 일이 생겼을 때 자기 서비스에서 잠기는 것을 막는다.
 */
export const ALLOWED_SIGNUP_EMAILS = ['martin1023@naver.com'];

export function isAllowedSignupEmail(email: string): boolean {
  const addr = email.trim().toLowerCase();
  if (ALLOWED_SIGNUP_EMAILS.includes(addr)) return true;
  const domain = addr.split('@')[1];
  return !!domain && ALLOWED_SIGNUP_DOMAINS.includes(domain);
}

/** 가입 화면과 거절 메시지에 같이 쓰는 안내문. */
export const SIGNUP_POLICY_NOTICE = `${ALLOWED_SIGNUP_DOMAINS.map((d) => `@${d}`).join(' · ')} 메일로만 가입할 수 있습니다.`;
