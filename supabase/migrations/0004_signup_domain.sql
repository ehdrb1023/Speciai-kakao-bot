-- 가입 도메인 제한 — Supabase before-user-created 훅.
--
-- 로그인 화면은 공개 URL 이라 주소만 알면 누구나 계정을 만들 수 있었다. RLS 가 남의
-- 워크스페이스를 가려주긴 하지만, 사내 전용 콘솔에 모르는 사람이 계정을 만드는 것 자체를
-- 막는다. 가입 경로가 여러 개(이메일 가입 · 카카오 OAuth)라 앱 코드에서 한 곳만 막아서는
-- 새는 곳이 남는다. 이 훅은 **모든 경로**의 사용자 생성 직전에 돌고, 거부하면 계정이
-- 아예 만들어지지 않는다.
--
-- ⚠️ 같은 판정이 두 곳에 있다: src/lib/auth/signup-policy.ts 를 함께 고칠 것.
--    (앱 쪽은 한국어 안내용, 실제 경계는 여기다 — anon 키는 브라우저에 노출돼 있다)
--
-- ⚠️ 이 파일을 적용한 뒤 Supabase 대시보드에서 훅을 켜야 동작한다:
--    Authentication → Hooks → Before User Created → Postgres →
--    schema public, function hook_restrict_signup_by_email_domain → Enable
--    켜지 않으면 이 함수는 그냥 아무도 안 부르는 함수다.
--
-- 이미 있는 계정은 영향을 받지 않는다. 훅은 "가입" 시점에만 돈다.

create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text;
  domain text;
  -- 회사 도메인. 여기 있는 메일이면 통과.
  allowed_domains text[] := array['speciai.ai.kr'];
  -- 도메인 밖이지만 예외로 허용하는 주소. 대표 계정이 회사 도메인이 아니라서,
  -- 계정을 다시 만들 일이 생겼을 때 자기 서비스에서 잠기지 않게 둔다.
  allowed_emails text[] := array['martin1023@naver.com'];
begin
  addr := lower(coalesce(event -> 'user' ->> 'email', ''));

  -- 이메일이 없는 신원(전화번호 가입 등)은 이 서비스에서 쓸 일이 없다. 막는 쪽으로 실패한다.
  if addr = '' then
    return jsonb_build_object(
      'error',
      jsonb_build_object('message', '이메일이 없는 계정은 가입할 수 없습니다.', 'http_code', 403)
    );
  end if;

  if addr = any (allowed_emails) then
    return '{}'::jsonb;
  end if;

  domain := split_part(addr, '@', 2);
  if domain = any (allowed_domains) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', '@' || array_to_string(allowed_domains, ' · @') || ' 메일로만 가입할 수 있습니다.',
      'http_code', 403
    )
  );
end;
$$;

-- 훅을 부르는 것은 auth 서비스뿐이다. 일반 사용자에게는 실행 권한을 주지 않는다.
grant execute on function public.hook_restrict_signup_by_email_domain to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain from authenticated, anon, public;
