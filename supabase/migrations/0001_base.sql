-- speciai-kakao-bot — 기반 스키마 (워크스페이스·멤버십·초대·감사)
-- kakao-advisor-bot 0001_base 에서 노무 자문 전용 테이블(client_companies, qa_answers)을
-- 제거한 형태. 거래처 도메인은 0002 에서 partners 로 새로 정의한다.

create extension if not exists "pgcrypto";

-- ── 사용자 / 프로필 ─────────────────────────────────────────────
create type member_role as enum ('owner', 'admin', 'viewer');

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  current_workspace_id uuid,
  created_at timestamptz not null default now()
);

-- ── 워크스페이스 / 멤버십 / 초대 ────────────────────────────────
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  -- 우리측(사내) 카톡 닉네임 목록. 이 이름들의 발화는 대화창에서 우측(우리)으로 표시한다.
  -- 카톡 닉네임은 계정 display_name 과 다른 경우가 대부분이라 수동 목록으로 보완한다.
  staff_aliases jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_workspace_fk
  foreign key (current_workspace_id) references workspaces(id);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'admin',
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists memberships_user_idx on memberships(user_id);
create index if not exists memberships_workspace_idx on memberships(workspace_id);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role member_role not null default 'admin',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invitations_token_idx on invitations(token);
create index if not exists invitations_workspace_idx on invitations(workspace_id);

-- ── 감사 로그 ───────────────────────────────────────────────────
create table if not exists audit_logs (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  target_table text,
  target_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on audit_logs(created_at desc);

-- ── 헬퍼 함수 ───────────────────────────────────────────────────
create or replace function current_workspace_role(ws_id uuid) returns member_role
language sql stable as $$
  select role from memberships
  where workspace_id = ws_id and user_id = auth.uid()
  limit 1
$$;

create or replace function is_workspace_member(ws_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from memberships
    where workspace_id = ws_id and user_id = auth.uid()
  )
$$;

-- 가입 시 profiles 자동 생성
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 워크스페이스 생성 — 생성자는 admin. 대표(owner)는 별도 지정.
create or replace function create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_ws_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from workspaces where slug = p_slug) then
    raise exception 'slug_taken';
  end if;

  insert into workspaces (name, slug, created_by)
  values (p_name, p_slug, v_uid)
  returning id into v_ws_id;

  insert into memberships (workspace_id, user_id, role)
  values (v_ws_id, v_uid, 'admin');

  update profiles set current_workspace_id = v_ws_id where id = v_uid;

  return v_ws_id;
end;
$$;

grant execute on function create_workspace(text, text) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table audit_logs enable row level security;

-- profiles: 본인만 read/update, 같은 워크스페이스 멤버는 read
create policy profiles_self_rw on profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_member_read on profiles
  for select to authenticated
  using (
    exists (
      select 1
      from memberships m1
      join memberships m2 on m1.workspace_id = m2.workspace_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.id
    )
  );

-- workspaces: 멤버만 read, owner만 update/delete, 누구나 create
create policy workspaces_member_read on workspaces
  for select to authenticated
  using (is_workspace_member(id));

create policy workspaces_insert on workspaces
  for insert to authenticated
  with check (auth.uid() = created_by);

create policy workspaces_admin_update on workspaces
  for update to authenticated
  using (current_workspace_role(id) in ('owner', 'admin'))
  with check (current_workspace_role(id) in ('owner', 'admin'));

create policy workspaces_owner_delete on workspaces
  for delete to authenticated
  using (current_workspace_role(id) = 'owner');

-- memberships: 같은 워크스페이스 멤버 read, owner/admin만 변경
create policy memberships_member_read on memberships
  for select to authenticated
  using (is_workspace_member(workspace_id));

create policy memberships_admin_insert on memberships
  for insert to authenticated
  with check (
    current_workspace_role(workspace_id) in ('owner', 'admin')
    or user_id = auth.uid()
  );

create policy memberships_admin_update on memberships
  for update to authenticated
  using (current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy memberships_self_or_owner_delete on memberships
  for delete to authenticated
  using (
    user_id = auth.uid()
    or current_workspace_role(workspace_id) = 'owner'
  );

-- invitations: owner/admin read·write. 토큰 수락은 서버 액션(service-role)에서 검증.
create policy invitations_admin_all on invitations
  for all to authenticated
  using (current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (current_workspace_role(workspace_id) in ('owner', 'admin'));

-- audit_logs: 본인 기록만 열람. 관리자 감사 뷰는 service-role 로 조회한다.
create policy audit_self_read on audit_logs
  for select to authenticated
  using (actor_id = auth.uid());

create policy audit_self_insert on audit_logs
  for insert to authenticated
  with check (actor_id = auth.uid() or actor_id is null);
