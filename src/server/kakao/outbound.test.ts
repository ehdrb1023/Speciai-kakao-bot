import { describe, expect, it } from 'vitest';
import { composeWireText } from './outbound';

// 접두는 거래처 화면에 그대로 보이는 문자열이다. 여기가 틀어지면 "누가 말한 건지 모르겠는
// 낯선 계정" 이 되거나, 대괄호가 겹쳐 어디까지가 이름인지 알 수 없게 된다.
describe('composeWireText', () => {
  it('담당자 이름을 대괄호로 앞에 붙인다', () => {
    expect(composeWireText('신동규', '내일 회신드리겠습니다')).toBe(
      '[신동규] 내일 회신드리겠습니다',
    );
  });

  it('본문 앞뒤 공백은 지운다 — 입력창 개행이 그대로 나가면 지저분하다', () => {
    expect(composeWireText('신동규', '  확인했습니다\n')).toBe('[신동규] 확인했습니다');
  });

  it('여러 줄 본문은 그대로 둔다 — 줄바꿈은 사람이 의도한 것이다', () => {
    expect(composeWireText('신동규', '1. 발주\n2. 납기')).toBe('[신동규] 1. 발주\n2. 납기');
  });

  it('이름 안의 대괄호는 지운다. 남기면 접두가 어디서 끝나는지 알 수 없다', () => {
    expect(composeWireText('[신동규]', '확인')).toBe('[신동규] 확인');
  });

  it('이름이 비면 접두 없이 본문만 — 빈 대괄호가 나가는 것보다 낫다', () => {
    expect(composeWireText('  ', '확인')).toBe('확인');
  });
});
