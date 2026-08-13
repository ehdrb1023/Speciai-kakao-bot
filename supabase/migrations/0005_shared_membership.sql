-- 소속 판정을 두 멤버 테이블의 합집합으로.
--
-- ⚠️ 이 Supabase 프로젝트에는 앱이 둘 있다.
--
--   | 앱 | 소속 테이블 | 주요 테이블 |
--   |---|---|---|
--   | linktalk | `workspace_members` (역할 없음) | threads, messages, customers, subscriptions, … |
--   | speciai-kakao-bot | `memberships` (owner/admin/viewer) | kakao_*, partners, partner_room_rules, invitations |
--
-- `workspaces` · `profiles` · 그리고 RLS 헬퍼 `is_workspace_member()` 는 **둘이 공유한다.**
-- 그래서 이 함수가 한쪽 테이블만 보면 다른 쪽 앱 사용자는 자기 워크스페이스조차 못 읽는다.
--
-- 실제로 그렇게 됐다(2026-08-13): 운영 DB 의 함수가 `workspace_members` 만 보고 있어서,
-- 카톡봇에서 관리자 권한을 준 계정이 화면에 "열람" 으로 뜨고 카톡방이 0개로 보였다.
-- `memberships` 에는 admin 행이 멀쩡히 있었지만 RLS 가 그 행 자체를 가려버렸다.
-- (역할 조회가 null 이면 화면은 '열람' 으로 표시된다 — 그래서 권한 문제로 안 보였다.)
--
-- 한쪽으로 통일하지 않고 합집합으로 두는 이유: `workspaces` 를 두 앱이 함께 읽으므로
-- "이 워크스페이스 사람인가" 의 답은 어느 앱 기준이든 참이어야 한다. 어느 한쪽 테이블만
-- 정답으로 삼는 순간 반대쪽 앱이 통째로 막힌다.
-- 워크스페이스 단위 격리는 그대로다 — 어느 쪽이든 **그 워크스페이스의** 행이 있어야 통과한다.
--
-- ⚠️ 0001_base.sql 에는 이 함수가 `memberships` 만 보도록 적혀 있다. 그 파일을 운영 DB 에
--    다시 실행하면 linktalk 이 통째로 막힌다. migrate-all.local.sql 도 마찬가지다.
--    빈 프로젝트가 아니면 0001 을 재실행하지 말고, 재실행했다면 이 파일을 뒤에 다시 돌릴 것.

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from workspace_members m where m.workspace_id = ws_id and m.user_id = auth.uid()
  ) or exists (
    select 1 from memberships m where m.workspace_id = ws_id and m.user_id = auth.uid()
  );
$$;
