// 카톡 방 안에서 치는 등록 명령. 순수 파싱만 둔다(DB 접근은 index.ts).
//
// 같은 문법이 두 곳에서 판정된다:
//   1) 서버 — 이 파서. 명령이면 메시지로 저장하지 않고 규칙을 만들거나 지운다
//   2) 봇 단말 — bot/speciai-bot.js 의 isRoomCommand. 규칙 밖 방에서도 이 메시지만 통과시킨다
// 어긋나면 단말이 통과시킨 명령을 서버가 일반 메시지로 취급해 저장해버린다.
// 문법을 바꾸면 반드시 양쪽을 함께 고치고 commands.test.ts 를 갱신할 것.
//
// 규칙 밖 방에서 이 한 종류만 단말 밖으로 나가는 것이 "개인 카톡은 서버에 도달하지 않는다"
// 원칙의 유일한 예외다. 예외를 넓히지 말 것 — 넓히는 순간 개인 대화가 새어 나간다.

export type RoomCommand =
  | { kind: 'bind'; partnerName: string }
  | { kind: 'unbind' };

/** 방 등록/해제 명령 파싱. 명령이 아니면 null(= 평범한 메시지). */
export function parseRoomCommand(text: string): RoomCommand | null {
  const t = text.replace(/\s+/g, ' ').trim();

  // 해제가 먼저다. "#등록해제" 는 "#등록" 뒤에 공백이 없어 아래 정규식에 걸리지 않지만,
  // 순서를 뒤집어도 되도록 읽히면 나중에 문법을 바꿀 때 사고가 난다.
  if (t === '#등록해제') return { kind: 'unbind' };

  const m = t.match(/^#등록\s+(.+)$/);
  if (!m) return null;

  const partnerName = m[1]!.trim();
  if (!partnerName) return null;
  return { kind: 'bind', partnerName };
}

/**
 * ilike 패턴으로 쓸 문자열 이스케이프. 거래처명·방 이름에 %, _ 가 들어 있으면
 * 와일드카드로 해석돼 엉뚱한 행을 집는다.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
