import { describe, expect, it } from 'vitest';
import {
  findPartnerInRoomName,
  isStaffSpeaker,
  matchRoomRule,
  normalizeRoomName,
  ruleMatches,
  sortRules,
  type RoomRule,
} from './rules';

function rule(partial: Partial<RoomRule> & Pick<RoomRule, 'pattern'>): RoomRule {
  return {
    id: partial.id ?? partial.pattern,
    partnerId: partial.partnerId ?? `p-${partial.pattern}`,
    kind: partial.kind ?? 'prefix',
    pattern: partial.pattern,
    priority: partial.priority ?? 0,
  };
}

describe('normalizeRoomName', () => {
  it('연속 공백을 하나로 접고 앞뒤를 자른다', () => {
    expect(normalizeRoomName('  [삼성전자]   3분기 발주 ')).toBe('[삼성전자] 3분기 발주');
  });
});

describe('ruleMatches', () => {
  it('prefix 는 앞부분만 본다', () => {
    expect(ruleMatches({ kind: 'prefix', pattern: '[삼성전자]' }, '[삼성전자] 3분기 발주')).toBe(true);
    expect(ruleMatches({ kind: 'prefix', pattern: '[삼성전자]' }, '재고 [삼성전자] 문의')).toBe(false);
  });

  it('공백 편차를 흡수한다', () => {
    expect(ruleMatches({ kind: 'prefix', pattern: '[삼성전자] ' }, '[삼성전자]  3분기')).toBe(true);
  });

  it('영문 거래처명은 대소문자를 무시한다', () => {
    expect(ruleMatches({ kind: 'prefix', pattern: '[LG화학]' }, '[lg화학] 납기')).toBe(true);
  });

  it('exact 는 완전일치만', () => {
    expect(ruleMatches({ kind: 'exact', pattern: '[삼성전자]' }, '[삼성전자]')).toBe(true);
    expect(ruleMatches({ kind: 'exact', pattern: '[삼성전자]' }, '[삼성전자] 발주')).toBe(false);
  });

  it('contains 는 어디에 있든 잡는다', () => {
    expect(ruleMatches({ kind: 'contains', pattern: '삼성' }, '3분기 삼성 발주건')).toBe(true);
  });

  it('regex 는 정규식으로 평가한다', () => {
    expect(ruleMatches({ kind: 'regex', pattern: '^\\[삼성(전자|SDI)\\]' }, '[삼성SDI] 견적')).toBe(true);
  });

  it('깨진 정규식은 그 규칙만 죽고 예외를 던지지 않는다', () => {
    expect(ruleMatches({ kind: 'regex', pattern: '[' }, '[삼성전자] 발주')).toBe(false);
  });

  it('빈 패턴은 아무것도 매칭하지 않는다 — 전 방 수집을 막는다', () => {
    expect(ruleMatches({ kind: 'prefix', pattern: '   ' }, '[삼성전자] 발주')).toBe(false);
  });
});

describe('sortRules', () => {
  it('priority 가 우선, 같으면 긴 패턴이 먼저', () => {
    const sorted = sortRules([
      rule({ pattern: '[삼성]', priority: 0 }),
      rule({ pattern: '[삼성전자 반도체]', priority: 0 }),
      rule({ pattern: '[LG]', priority: 9 }),
    ]);
    expect(sorted.map((r) => r.pattern)).toEqual(['[LG]', '[삼성전자 반도체]', '[삼성]']);
  });
});

describe('matchRoomRule', () => {
  it('더 구체적인 접두어가 이긴다', () => {
    const rules = [rule({ pattern: '[삼성전자]' }), rule({ pattern: '[삼성전자 반도체]' })];
    expect(matchRoomRule('[삼성전자 반도체] 견적', rules)?.pattern).toBe('[삼성전자 반도체]');
  });

  it('걸리는 규칙이 없으면 null — 미분류 방으로 남는다', () => {
    expect(matchRoomRule('고등학교 동창', [rule({ pattern: '[삼성전자]' })])).toBeNull();
  });
});

describe('isStaffSpeaker', () => {
  it('완전일치는 짧은 이름도 잡는다', () => {
    expect(isStaffSpeaker('김', ['김'])).toBe(true);
  });

  it('부분일치는 3자 이상 별칭에만 적용한다', () => {
    expect(isStaffSpeaker('김부장', ['김'])).toBe(false);
    expect(isStaffSpeaker('스페셜아이 신동규', ['신동규'])).toBe(true);
  });

  it('별칭이 없으면 전부 거래처측', () => {
    expect(isStaffSpeaker('신동규', [])).toBe(false);
  });
});

describe('findPartnerInRoomName — 방 이름에 박힌 거래처 자동 연결', () => {
  const partners = [
    { id: 'p1', name: '스페시아이' },
    { id: 'p2', name: '삼성전자' },
  ];

  it('대괄호 안에 거래처명이 있으면 찾는다', () => {
    expect(findPartnerInRoomName('[스페시아이] 발주', partners)?.id).toBe('p1');
    expect(findPartnerInRoomName('발주 [삼성전자]', partners)?.id).toBe('p2');
    expect(findPartnerInRoomName('[스페시아이]발주', partners)?.id).toBe('p1');
  });

  it('대괄호 안이 거래처명과 정확히 같아야 붙는다', () => {
    // "스페시아이" 가 "[스페시아이테크]" 방을 가져가면 두 거래처 대화가 한 곳에 섞인다.
    expect(findPartnerInRoomName('[스페시아이테크] 발주', partners)).toBeNull();
    expect(findPartnerInRoomName('[스페시아이 2공장] 자재', partners)).toBeNull();
    expect(findPartnerInRoomName('[스페시아이-품질]', partners)).toBeNull();
  });

  it('그 이름의 거래처가 따로 등록돼 있으면 거기로 붙는다', () => {
    const both = [...partners, { id: 'p3', name: '스페시아이테크' }];
    expect(findPartnerInRoomName('[스페시아이테크] 발주', both)?.id).toBe('p3');
    expect(findPartnerInRoomName('[스페시아이] 발주', both)?.id).toBe('p1');
  });

  it('대괄호 밖의 이름은 잡지 않는다 — 개인 방을 빨아들이지 않기 위함', () => {
    expect(findPartnerInRoomName('삼성전자 동호회', partners)).toBeNull();
    expect(findPartnerInRoomName('스페시아이 회식방', partners)).toBeNull();
  });

  it('대괄호가 여럿이어도 한 거래처만 걸리면 붙는다', () => {
    expect(findPartnerInRoomName('[발주] [스페시아이] 3월', partners)?.id).toBe('p1');
  });



  it('봇이 지어낸 열쇠 이름에는 적용하지 않는다', () => {
    expect(findPartnerInRoomName('방#476647316580151', [{ id: 'p3', name: '방' }])).toBeNull();
  });

  it('서로 다른 거래처가 걸리면 아무것도 고르지 않는다', () => {
    const two = [
      { id: 'p1', name: '가나다라' },
      { id: 'p2', name: '마바사아' },
    ];
    expect(findPartnerInRoomName('[가나다라] [마바사아] 공동', two)).toBeNull();
  });

  it('대괄호가 없거나 거래처가 없으면 null', () => {
    expect(findPartnerInRoomName('그냥 방 이름', partners)).toBeNull();
    expect(findPartnerInRoomName('[없는회사] 발주', partners)).toBeNull();
    expect(findPartnerInRoomName('[스페시아이] 발주', [])).toBeNull();
  });

  it('전각 대괄호도 읽는다 — 카톡 방 제목에 섞여 들어온다', () => {
    expect(findPartnerInRoomName('【스페시아이】 발주', partners)?.id).toBe('p1');
  });
});
