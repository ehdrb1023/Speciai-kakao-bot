import { describe, expect, it } from 'vitest';
import { escapeLikePattern, parseRoomCommand } from './commands';

// 이 문법은 bot/speciai-bot.js 의 isRoomCommand 와 같은 결과를 내야 한다.
// 여기를 고치면 봇 스크립트도 함께 고칠 것.

describe('parseRoomCommand', () => {
  it('#등록 <거래처명> 을 bind 로 읽는다', () => {
    expect(parseRoomCommand('#등록 삼성전자')).toEqual({ kind: 'bind', partnerName: '삼성전자' });
  });

  it('거래처명에 공백이 있어도 통째로 받는다', () => {
    expect(parseRoomCommand('#등록 삼성전자 반도체')).toEqual({
      kind: 'bind',
      partnerName: '삼성전자 반도체',
    });
  });

  it('앞뒤·연속 공백을 정규화한다', () => {
    expect(parseRoomCommand('  #등록   삼성전자  ')).toEqual({
      kind: 'bind',
      partnerName: '삼성전자',
    });
  });

  it('#등록해제 를 unbind 로 읽는다', () => {
    expect(parseRoomCommand('#등록해제')).toEqual({ kind: 'unbind' });
    expect(parseRoomCommand('  #등록해제 ')).toEqual({ kind: 'unbind' });
  });

  it('거래처명 없는 #등록 은 명령이 아니다', () => {
    // 명령으로 받아버리면 빈 이름의 거래처가 생긴다. 평범한 메시지로 흘려보낸다.
    expect(parseRoomCommand('#등록')).toBeNull();
    expect(parseRoomCommand('#등록 ')).toBeNull();
  });

  it('평범한 메시지는 명령이 아니다', () => {
    expect(parseRoomCommand('오늘 발주 등록했습니다')).toBeNull();
    expect(parseRoomCommand('#발주 삼성전자')).toBeNull();
    expect(parseRoomCommand('')).toBeNull();
  });

  it('문장 중간의 #등록 은 명령이 아니다', () => {
    // 대화 중 "이거 #등록 해주세요" 같은 말이 명령으로 실행되면 안 된다.
    expect(parseRoomCommand('이거 #등록 삼성전자')).toBeNull();
  });

  it('#등록해제 뒤에 다른 말이 붙으면 명령이 아니다', () => {
    expect(parseRoomCommand('#등록해제 해주세요')).toBeNull();
  });
});

describe('escapeLikePattern', () => {
  it('ilike 와일드카드를 무력화한다', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('평범한 이름은 그대로 둔다', () => {
    expect(escapeLikePattern('[삼성전자] 발주')).toBe('[삼성전자] 발주');
  });
});
