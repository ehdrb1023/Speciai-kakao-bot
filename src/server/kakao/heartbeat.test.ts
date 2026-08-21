import { describe, expect, it } from 'vitest';
import { botLivenessOf, HEARTBEAT_DOWN_MS, HEARTBEAT_OK_MS } from './heartbeat';

const NOW = new Date('2026-08-18T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('botLivenessOf — 봇이 살아 있나', () => {
  it('신호가 없으면 판정하지 않는다', () => {
    expect(botLivenessOf(null, NOW)).toBe('unknown');
    expect(botLivenessOf('말도 안 되는 값', NOW)).toBe('unknown');
  });

  it('폴링 주기 안이면 정상', () => {
    expect(botLivenessOf(ago(0), NOW)).toBe('ok');
    // 조용할 때 주기가 60초라 한두 번 건너뛰어도 정상으로 본다
    expect(botLivenessOf(ago(150_000), NOW)).toBe('ok');
  });

  it('3분을 넘기면 지연 — 절전에 들어갔을 수 있다', () => {
    expect(botLivenessOf(ago(HEARTBEAT_OK_MS), NOW)).toBe('delayed');
    expect(botLivenessOf(ago(20 * 60 * 1000), NOW)).toBe('delayed');
  });

  it('30분을 넘기면 끊김 — 재워진 것이 아니라 죽은 것이다', () => {
    expect(botLivenessOf(ago(HEARTBEAT_DOWN_MS), NOW)).toBe('down');
    expect(botLivenessOf(ago(6 * 60 * 60 * 1000), NOW)).toBe('down');
  });

  it('폰 시계가 앞서 미래 시각이 와도 정상으로 본다', () => {
    // 여기서 down 이 나오면 시계가 어긋난 폰이 영원히 "죽음" 으로 뜬다.
    expect(botLivenessOf(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe('ok');
  });
});
