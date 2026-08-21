-- 봇 단말 생존 신호(심장박동)
--
-- 왜 필요한가: 이 시스템에는 "봇이 살아 있다" 를 말해주는 것이 아무것도 없었다. 봇이
-- 죽어도 DB 에는 아무 행도 안 생기고, 규칙에 안 걸려 수집이 0인 것과 구분이 안 된다.
-- 2026-08-17 에 삼성 절전이 메신저봇R 을 재운 것을 사람이 알아챈 것은 하루가 지나서였고,
-- 그때도 Vercel 로그를 스크롤해서야 확인했다.
--
-- 봇은 이미 1분마다 /api/kakao/bot/outbox 를 두드린다. 그 왕복에 시각 한 줄만 얹으면
-- 화면이 대신 판단해줄 수 있다. 봇 스크립트는 건드리지 않는다.
--
-- ⚠️ workspaces 에 컬럼을 붙이지 않는다 — 그 테이블은 linktalk 과 같이 쓴다.
--    kakao_ 접두 테이블은 이 앱 전용이라 부딪히지 않는다.
create table if not exists kakao_bot_status (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  -- 봇이 마지막으로 서버를 두드린 시각. 이 값 하나로 "앱이 살아 있나" 가 정해진다.
  last_seen_at timestamptz not null default now(),
  -- 직전 두드림과의 간격(ms). 이게 있어야 "재워짐" 과 "죽음" 이 갈린다 —
  -- Doze 에 들어가면 간격만 벌어지고(수집은 알림이 깨워서 계속된다), 앱이 죽으면 끊긴다.
  last_gap_ms integer,
  -- 어느 경로로 온 신호인지. 'outbox'(폴링) · 'ingest'(메시지 수신) · 'rules'(규칙 조회)
  last_source text,
  updated_at timestamptz not null default now()
);

alter table kakao_bot_status enable row level security;

-- 봇은 service-role 로 기록하므로 RLS 를 타지 않는다. 이 정책은 콘솔에서 읽기용이다.
create policy kakao_bot_status_member_read on kakao_bot_status
  for select to authenticated
  using (is_workspace_member(workspace_id));
