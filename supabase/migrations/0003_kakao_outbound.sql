-- 대시보드 → 카톡방 발신 큐
--
-- 왜 큐인가: 서버는 카톡에 직접 말할 수 없다. 봇 단말만이 알림에 실린 RemoteInput 세션으로
-- 방에 글을 넣을 수 있고, 그 단말은 폰이라 언제 깨어 있을지 모른다. 그래서 대시보드는
-- "보낸다" 가 아니라 "보낼 것을 적어둔다" 이고, 봇이 가져가 보낸 뒤 결과를 되돌려준다.
--
-- 그래서 사용자에게는 반드시 상태가 보여야 한다. 업무 카톡에서 "보낸 줄 알았는데 안 갔다"
-- 가 제일 나쁘다. 대기·전송됨·실패를 화면에 그대로 드러낸다.
--
--   pending  적어둠. 아직 봇이 안 가져감
--   sending  봇이 가져감(리스). 2분 안에 결과가 없으면 pending 으로 되돌린다
--   sent     방에 실제로 들어감 → 같은 내용이 kakao_messages 에 side='us' 로 복사된다
--   failed   3회 시도 실패. 사람이 카톡에서 직접 보내야 한다
--   canceled 아직 안 나간 것을 사람이 취소함
create table if not exists kakao_outbound (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_id uuid not null references kakao_rooms(id) on delete cascade,
  -- 사람이 입력한 원문. 카톡에 나갈 때는 앞에 "[담당자] " 가 붙는다(조립은 서버가 한다).
  body text not null,
  -- 접두에 쓸 이름. 봇 계정 하나로 여러 담당자가 답하므로 이게 없으면 거래처가 누군지 모른다.
  author_name text not null,
  author_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  attempts integer not null default 0,
  -- 봇이 가져간 시각. 폰이 도중에 죽으면 sending 으로 영원히 남으므로 이 값으로 되살린다.
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kakao_outbound_status_chk
    check (status in ('pending', 'sending', 'sent', 'failed', 'canceled')),
  constraint kakao_outbound_body_chk check (length(btrim(body)) > 0)
);

-- 봇이 매 폴링마다 "보낼 것 있나" 를 묻는다. 그 조회가 이 인덱스 하나로 끝나야 한다.
create index if not exists kakao_outbound_pending_idx
  on kakao_outbound(workspace_id, status, created_at)
  where status in ('pending', 'sending');
create index if not exists kakao_outbound_room_idx
  on kakao_outbound(room_id, created_at desc);

alter table kakao_outbound enable row level security;

-- 봇은 service-role 로 오므로 RLS 를 타지 않는다. 여기 정책은 콘솔 사용자용이다.
-- viewer 도 통과하는 정책인 점에 주의 — 발신 권한 검사는 라우트에서 role 로 한다.
create policy kakao_outbound_member_all on kakao_outbound
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
