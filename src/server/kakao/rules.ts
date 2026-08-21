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

/**
 * `#등록`·자동 연결이 만드는 exact 규칙의 우선순위.
 * 패턴 방식이던 시절의 접두어 규칙보다 먼저 걸려야 한다 — 방에서 한 번 선언한 것이,
 * 또는 거래처명이 방 이름에 박혀 있는 것이, 예전 접두어보다 구체적인 의사표시다.
 */
export const BIND_RULE_PRIORITY = 100;

/** 방 이름 안에서 거래처를 찾을 때 필요한 최소 정보. */
export interface PartnerNameRef {
  id: string;
  name: string;
}

/**
 * 방 이름 안의 대괄호 토큰. "[스페시아이] 발주" → ["스페시아이"]
 *
 * 대괄호만 보는 이유: 맨 이름으로 부분일치를 하면 "삼성" 이라는 거래처 하나가
 * "삼성동 동창회" 같은 개인 단톡방을 통째로 빨아들인다. 거래처 방 제목에 대괄호로
 * 회사명을 박는 것은 사람이 의도적으로 한 표시라, 우연히 걸릴 여지가 없다.
 */
const BRACKET_TOKEN_RE = /[[［【]([^\]］】]+)[\]］】]/g;

export function bracketedTokens(roomName: string): string[] {
  const room = normalizeRoomName(roomName);
  const out: string[] = [];
  BRACKET_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_TOKEN_RE.exec(room)) !== null) {
    const token = normalizeRoomName(m[1] ?? '');
    if (token) out.push(token);
  }
  return out;
}

/**
 * 대괄호 안이 거래처명과 **정확히 같을 때만** 인정한다(대소문자만 무시).
 *
 * 앞부분만 같아도 인정하던 때가 있었는데, 그러면 "스페시아이" 하나가 "[스페시아이테크]"
 * 방까지 가져간다(2026-08-18 대표 지적). 이웃한 두 거래처의 대화가 한 곳에 섞이면
 * 사람이 눈치채기까지 오래 걸리고, 그동안 쌓인 것을 나중에 갈라낼 방법이 없다.
 * 완전일치만 인정하면 "스페시아이테크" 는 그 이름의 거래처를 만들어야 붙는다 —
 * 안 붙는 것은 미분류 목록에 떠서 바로 보이지만, 잘못 붙은 것은 안 보인다.
 */
function tokenNamesPartner(token: string, partnerName: string): boolean {
  return token.toLowerCase() === partnerName.toLowerCase();
}

/**
 * 방 이름에 대괄호로 박힌 거래처. 없으면 null.
 *
 * 여기서 찾히면 서버가 그 자리에서 `#등록` 과 똑같은 exact 규칙을 만든다 — 사람이 방에
 * 들어가 명령을 칠 필요가 없다. 그래서 판정은 보수적으로 한다:
 *   · 대괄호 안에서만 찾는다(위 BRACKET_TOKEN_RE 주석 참고)
 *   · 대괄호 안이 거래처명과 **정확히 같아야** 한다(tokenNamesPartner)
 *   · 서로 다른 거래처가 걸리면 **아무것도 고르지 않는다**. 둘 중 하나를 찍는 것보다
 *     미분류로 남겨 사람 눈에 띄게 하는 편이 낫다 — 한 번 잘못 붙으면 그 방 대화가
 *     계속 엉뚱한 거래처에 쌓인다.
 *
 * 이 판정에 걸리지 않는다고 수집이 막히는 것은 아니다. 대괄호 없이 쓰던 기존 방들은
 * 이미 `exact` 규칙으로 붙어 있고 그 규칙이 먼저 매칭된다. 여기는 **아직 아무 규칙에도
 * 안 걸린 방**에만 닿는 마지막 갈래다.
 */
export function findPartnerInRoomName(
  roomName: string,
  partners: PartnerNameRef[],
): PartnerNameRef | null {
  if (isGeneratedRoomName(roomName)) return null;
  const tokens = bracketedTokens(roomName);
  if (tokens.length === 0) return null;

  let best: PartnerNameRef | null = null;

  for (const partner of partners) {
    const name = normalizeRoomName(partner.name);
    if (!name) continue;
    if (!tokens.some((t) => tokenNamesPartner(t, name))) continue;
    // 대괄호가 둘 이상인 방("[가나다] [마바사] 공동")에서 서로 다른 거래처가 걸리는 경우다.
    // 어느 쪽 방인지 사람만 안다. 찍지 않고 미분류로 남긴다.
    if (best && best.id !== partner.id) return null;
    best = { id: partner.id, name };
  }

  return best;
}
