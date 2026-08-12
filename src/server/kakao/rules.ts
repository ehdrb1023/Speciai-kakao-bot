// 방 이름 → 거래처 매칭 규칙. 순수 함수만 둔다.
//
// 같은 로직이 두 곳에서 돌아간다:
//   1) 서버 — 도착한 메시지를 어느 거래처에 붙일지 판정
//   2) 봇 단말 — 이 방을 서버로 보낼지 말지 선판정 (bot/speciai-bot.js 가 같은 규칙을 구현)
// 두 구현이 어긋나면 "단말은 보냈는데 서버가 버리는" 방이 생긴다. 규칙 문법을 바꾸면
// 반드시 봇 스크립트의 matchRule 도 같이 고칠 것.

export type RoomRuleKind = 'prefix' | 'exact' | 'contains' | 'regex';

export interface RoomRule {
  id: string;
  partnerId: string;
  kind: RoomRuleKind;
  pattern: string;
  priority: number;
  /** 거래처명. 방 이름이 열쇠(`방#…`)일 때 화면에 대신 보여줄 이름이다. */
  partnerName?: string | null;
}

/**
 * 봇이 방 제목을 못 얻어 열쇠로 지어낸 이름인가.
 *
 * 이 단말의 카톡 알림에는 방 제목이 없어서 봇이 알림 식별자로 `방#<열쇠>` 를 만든다.
 * 매칭에는 그 값이 그대로 필요하지만(그게 유일한 방 구분 근거다), 사람에게 보여줄 이름으로는
 * 쓸모가 없다. 화면에서는 거래처명으로 갈아 끼운다 — 표시만 바꾸는 것이고 매칭은 안 건드린다.
 */
export const ROOM_KEY_PREFIX = '방#';

export function isGeneratedRoomName(name: string): boolean {
  return normalizeRoomName(name).startsWith(ROOM_KEY_PREFIX);
}

/**
 * 방 이름 정규화. 카톡 방 제목은 앞뒤 공백·연속 공백이 들쭉날쭉해서
 * 그대로 비교하면 "[삼성전자]  발주" 가 "[삼성전자] 발주" 와 다른 방이 된다.
 */
export function normalizeRoomName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** 규칙 1건이 방 이름에 걸리는지. 대소문자는 무시한다(거래처명이 영문일 때를 위해). */
export function ruleMatches(rule: Pick<RoomRule, 'kind' | 'pattern'>, roomName: string): boolean {
  const room = normalizeRoomName(roomName);
  const pattern = normalizeRoomName(rule.pattern);
  if (!room || !pattern) return false;

  const r = room.toLowerCase();
  const p = pattern.toLowerCase();

  switch (rule.kind) {
    case 'prefix':
      return r.startsWith(p);
    case 'exact':
      return r === p;
    case 'contains':
      return r.includes(p);
    case 'regex':
      try {
        return new RegExp(pattern, 'i').test(room);
      } catch {
        // 잘못 입력된 정규식이 전체 수집을 막으면 안 된다. 그 규칙만 죽은 것으로 본다.
        return false;
      }
    default:
      return false;
  }
}

/**
 * 우선순위 정렬. 앞에 오는 규칙이 먼저 매칭된다.
 *   1) priority 큰 것 — 사용자가 명시적으로 정한 순서
 *   2) pattern 긴 것 — "[삼성전자 반도체]" 가 "[삼성전자]" 를 이긴다(더 구체적인 쪽)
 *   3) pattern 사전순 — 위 둘이 같을 때 결과를 결정론으로 고정
 */
export function sortRules<T extends Pick<RoomRule, 'pattern' | 'priority'>>(rules: T[]): T[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
    return a.pattern.localeCompare(b.pattern);
  });
}

/** 방 이름에 걸리는 첫 규칙. 없으면 null(= 미분류 방). */
export function matchRoomRule(roomName: string, rules: RoomRule[]): RoomRule | null {
  for (const rule of sortRules(rules)) {
    if (ruleMatches(rule, roomName)) return rule;
  }
  return null;
}

/**
 * 발화자가 우리측인지 판정. aliases 는 workspaces.staff_aliases 에 등록한 카톡 닉네임 목록.
 *
 * 부분일치를 3자 이상 이름에만 적용하는 이유: "김" 같은 짧은 별칭을 등록해두면
 * 거래처 담당자 "김부장" 까지 우리측으로 오판정한다.
 */
export function isStaffSpeaker(speaker: string, aliases: string[]): boolean {
  const s = normalizeRoomName(speaker).toLowerCase();
  if (!s) return false;
  for (const raw of aliases) {
    const a = normalizeRoomName(raw).toLowerCase();
    if (!a) continue;
    if (s === a) return true;
    if (a.length >= 3 && s.includes(a)) return true;
  }
  return false;
}
