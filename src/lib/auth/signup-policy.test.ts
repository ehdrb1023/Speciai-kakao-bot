import { describe, expect, it } from 'vitest';
import { isAllowedSignupEmail } from './signup-policy';

// 이 판정은 supabase/migrations/0004_signup_domain.sql 의 훅과 같은 결과를 내야 한다.
// 여기를 고치면 마이그레이션도 함께 고칠 것.

describe('isAllowedSignupEmail', () => {
  it('회사 도메인은 통과한다', () => {
    expect(isAllowedSignupEmail('hong@speciai.ai.kr')).toBe(true);
  });

  it('대소문자·공백은 정규화해서 본다 — 사람이 손으로 치는 값이다', () => {
    expect(isAllowedSignupEmail('  Hong@SpeciAI.ai.kr ')).toBe(true);
  });

  it('예외로 등록한 주소는 도메인 밖이어도 통과한다', () => {
    expect(isAllowedSignupEmail('martin1023@naver.com')).toBe(true);
  });

  it('그 밖의 도메인은 막는다', () => {
    expect(isAllowedSignupEmail('stranger@gmail.com')).toBe(false);
    expect(isAllowedSignupEmail('hong@naver.com')).toBe(false);
  });

  // 하위 도메인·접미사로 회사 도메인을 흉내내는 주소. 문자열 포함으로 판정하면 전부 통과한다.
  it('도메인을 흉내낸 주소는 막는다', () => {
    expect(isAllowedSignupEmail('a@speciai.ai.kr.attacker.com')).toBe(false);
    expect(isAllowedSignupEmail('a@notspeciai.ai.kr')).toBe(false);
    expect(isAllowedSignupEmail('a@sub.speciai.ai.kr')).toBe(false);
  });

  it('@ 가 없거나 빈 값이면 막는다', () => {
    expect(isAllowedSignupEmail('')).toBe(false);
    expect(isAllowedSignupEmail('speciai.ai.kr')).toBe(false);
  });
});
