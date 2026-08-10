// 워크스페이스 단위 권한. DB member_role enum(0001_base)과 값이 일치해야 한다.
export type MemberRole = 'owner' | 'admin' | 'viewer';

/** 멤버 초대·역할 변경·설정 편집 권한. viewer 는 열람만 한다. */
export function canManageMembers(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
