-- speciai-kakao-bot — 거래처 카톡 수집 스키마
--
-- 핵심 발상: 우리 단톡방 이름은 "[삼성전자] 3분기 발주" 처럼 접두어 규칙이 잡혀 있다.
-- 그 규칙(partner_room_rules)을 대시보드에서 등록하면
--   1) 봇 단말이 규칙을 내려받아 개인 카톡방을 단말에서 걸러내고(서버에 아예 안 보냄)
--   2) 서버는 도착한 방 이름을 규칙에 맞춰 거래처(partners)에 붙인다.
-- advisor-bot 의 "방 이름 완전일치" 방식과 달리, 방 이름 뒷부분이 바뀌어도 계속 붙는다.

-- ── 1. 거래처 ───────────────────────────────────────────────────
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  -- 목록 눈구분용 고정 팔레트. 자유 hex 를 안 받는 이유는 라이트/다크 대비 보장 불가.
  color text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partners_color_chk
    check (color is null or color in ('blue', 'green', 'amber', 'red', 'purple', 'gray'))
);

create unique index if not exists partners_name_uniq on partners(workspace_id, lower(name));
create index if not exists partners_workspace_idx on partners(workspace_id);

-- ── 2. 방 이름 매칭 규칙 ────────────────────────────────────────
-- prefix   : 방 이름이 pattern 으로 시작 — "[삼성전자]"  ← 기본이자 권장
-- exact    : 방 이름이 pattern 과 완전일치
-- contains : 방 이름에 pattern 이 포함
-- regex    : 자바스크립트 정규식 소스. 봇 단말에서도 같은 문법으로 평가된다.
create type room_rule_kind as enum ('prefix', 'exact', 'contains', 'regex');

create table if not exists partner_room_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  kind room_rule_kind not null default 'prefix',
  pattern text not null,
  -- 큰 값이 먼저 매칭된다. "[삼성전자 반도체]" 를 "[삼성전자]" 보다 앞세울 때 쓴다.
  priority integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 규칙을 두 거래처에 못 붙인다. 붙이면 어느 쪽으로 갈지 비결정적이 된다.
create unique index if not exists partner_room_rules_uniq
  on partner_room_rules(workspace_id, kind, lower(pattern));
create index if not exists partner_room_rules_partner_idx on partner_room_rules(partner_id);
create index if not exists partner_room_rules_lookup_idx
  on partner_room_rules(workspace_id, enabled, priority desc);

-- ── 3. 카톡 방 ──────────────────────────────────────────────────
-- 봇이 메시지를 보내면 자동 생성된다. 규칙에 안 걸린 방도 partner_id = null 로 남겨
-- 대시보드 "미분류" 목록에 띄운다(규칙 누락을 눈으로 잡기 위함).
create table if not exists kakao_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  partner_id uuid references partners(id) on delete set null,
  -- 방 식별자. 메신저봇R API2 의 chatId 가 있으면 그 값, 없으면 'name:<방이름>'.
  -- chatId 기반이면 방 제목을 바꿔도 같은 방으로 이어진다.
  room_key text not null,
  room_name text not null,
  -- 어느 규칙으로 붙었는지 — 규칙을 지웠을 때 재매칭 대상을 찾기 위해 남긴다.
  matched_rule_id uuid references partner_room_rules(id) on delete set null,
  color text,
  pinned_at timestamptz,
  -- 처리 완료 표시. 지우는 게 아니라 목록에서 내리는 용도.
  handled_at timestamptz,
  -- 숨김(soft delete). 대화 기록은 그대로 보존한다.
  deleted_at timestamptz,
  last_message_at timestamptz,
  last_preview text,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kakao_rooms_color_chk
    check (color is null or color in ('blue', 'green', 'amber', 'red', 'purple', 'gray'))
);

create unique index if not exists kakao_rooms_key_uniq on kakao_rooms(workspace_id, room_key);
create index if not exists kakao_rooms_partner_idx on kakao_rooms(partner_id);
create index if not exists kakao_rooms_recent_idx
  on kakao_rooms(workspace_id, last_message_at desc);
create index if not exists kakao_rooms_deleted_idx
  on kakao_rooms(deleted_at) where deleted_at is not null;

-- ── 4. 메시지 ───────────────────────────────────────────────────
-- side: 'us' = 우리측 발화(workspaces.staff_aliases 로 판정), 'partner' = 거래처측.
create table if not exists kakao_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_id uuid not null references kakao_rooms(id) on delete cascade,
  speaker text not null,
  body text not null,
  side text not null default 'partner',
  -- 첨부 이미지 { path, type, name } — Storage 버킷 kakao-attachments 경로.
  attachment jsonb,
  -- 멱등 키 = md5(sent_at|speaker|body). 방 단위 유니크라 재전송·중복수신이 걸러진다.
  content_hash text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint kakao_messages_side_chk check (side in ('us', 'partner'))
);

-- 부분 인덱스가 아닌 완전 유니크라 supabase-js upsert(onConflict) 가 정상 추론한다.
create unique index if not exists kakao_messages_dedup_uniq
  on kakao_messages(room_id, content_hash);
create index if not exists kakao_messages_room_idx
  on kakao_messages(room_id, sent_at asc);
create index if not exists kakao_messages_recent_idx
  on kakao_messages(workspace_id, sent_at desc);

-- ── 5. 미분류 방 로그 ───────────────────────────────────────────
-- 규칙에 안 걸려 저장하지 않은 방을 이름만 기록한다. 본문은 저장하지 않는다.
-- 용도: "이 방 규칙 등록 안 했네" 를 대시보드에서 눈으로 잡기.
create table if not exists kakao_unmatched_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  room_key text not null,
  room_name text not null,
  hit_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create unique index if not exists kakao_unmatched_rooms_uniq
  on kakao_unmatched_rooms(workspace_id, room_key);

-- ── 6. RLS ──────────────────────────────────────────────────────
alter table partners enable row level security;
alter table partner_room_rules enable row level security;
alter table kakao_rooms enable row level security;
alter table kakao_messages enable row level security;
alter table kakao_unmatched_rooms enable row level security;

create policy partners_member_all on partners
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy partner_room_rules_member_all on partner_room_rules
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy kakao_rooms_member_all on kakao_rooms
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy kakao_messages_member_all on kakao_messages
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy kakao_unmatched_rooms_member_all on kakao_unmatched_rooms
  for all to authenticated
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- ── 7. 첨부 이미지 버킷 ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('kakao-attachments', 'kakao-attachments', false)
on conflict (id) do nothing;

-- 버킷 접근은 로그인 사용자로 한정. 경로 앞단이 workspace_id 라 워크스페이스 확인이 가능하다.
-- uuid 캐스팅 전에 형식을 검사하는 이유: 경로가 uuid 로 시작하지 않는 객체가 하나라도 있으면
-- 캐스팅 예외가 나면서 정책 평가 자체가 실패해 버킷 전체 조회가 막힌다.
create policy kakao_attachments_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'kakao-attachments'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and is_workspace_member(split_part(name, '/', 1)::uuid)
  );
