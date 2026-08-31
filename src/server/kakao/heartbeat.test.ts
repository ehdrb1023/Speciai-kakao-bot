import { describe, expect, it } from 'vitest';
import {
  botLivenessOf,
  roomSendStateOf,
  HEARTBEAT_DOWN_MS,
  HEARTBEAT_OK_MS,
  SENDABLE_STALE_MS,
} from './heartbeat';

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

describe('roomSendStateOf — 지금 이 방으로 보낼 수 있나', () => {
  const hb = (rooms: string[] | null, at: string | null) => ({
    lastSeenAt: ago(0),
    lastGapMs: null,
    lastSource: 'outbox',
    sendableRooms: rooms,
    sendableAt: at,
  });

  it('목록에 있으면 열림', () => {
    expect(roomSendStateOf(hb(['방#475980158535455'], ago(0)), '방#475980158535455', NOW)).toBe('open');
  });

  it('목록에 없으면 닫힘 — 이때만 화면이 경고한다', () => {
    expect(roomSendStateOf(hb(['방#111'], ago(0)), '방#475980158535455', NOW)).toBe('closed');
  });

  it('공백·대소문자는 규칙 매칭과 같이 무시한다', () => {
    expect(roomSendStateOf(hb(['[Speciai]  발주'], ago(0)), '[speciai] 발주', NOW)).toBe('open');
  });

  // 여기가 이 기능의 핵심이다. 근거가 낡거나 없으면 "못 보낸다" 고 단정하지 않는다 —
  // 멀쩡한 방에 뜨는 거짓 경고는 경보가 없느니만 못하다(한 번 겪으면 다음부터 아무도 안 본다).
  it('봇이 목록을 올린 적 없으면 판정하지 않는다 — 구버전 스크립트', () => {
    expect(roomSendStateOf(hb(null, null), '방#475980158535455', NOW)).toBe('unknown');
    expect(roomSendStateOf(null, '방#475980158535455', NOW)).toBe('unknown');
  });

  it('목록이 낡았으면 판정하지 않는다 — 봇이 죽은 것이지 방이 닫힌 게 아니다', () => {
    expect(roomSendStateOf(hb([], ago(SENDABLE_STALE_MS)), '방#475980158535455', NOW)).toBe('unknown');
    // 5분 안이면 빈 목록도 근거로 인정한다(통로가 정말 하나도 없는 상태)
    expect(roomSendStateOf(hb([], ago(SENDABLE_STALE_MS - 1000)), '방#475980158535455', NOW)).toBe('closed');
  });

  it('규칙이 지워진 방은 판정하지 않는다 — 통로가 아니라 연결이 끊긴 것이다', () => {
    expect(roomSendStateOf(hb(['방#111'], ago(0)), null, NOW)).toBe('unknown');
  });
});
