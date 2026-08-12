import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/lib/db';
import {
  bindRoomToPartner,
  claimOutbound,
  ingestBotMessage,
  matchRoomForWorkspace,
  normalizeRoomName,
  parseRoomCommand,
  recordUnmatchedRoom,
  resolveBotWorkspaceId,
  roomKeyOf,
  unbindRoom,
} from '@/server/kakao';
import { logAuditMachine } from '@/server/audit';
import { ingestTokenValid } from '@/server/kakao/ingest-token';

// 메신저봇R 인입 엔드포인트. 봇이 거래처 단톡방에서 수신한 메시지 1건을 올린다.
// 세션(브라우저 로그인) 대신 머신 토큰 인증 → service-role 로 RLS 우회.
//
// 인증: X-Ingest-Token = KAKAO_INGEST_TOKEN
// 입력: { room, sender, text, chatId?, logId?, ts?, image?, imageName? }
//   room     카톡 방 제목 → partner_room_rules 로 거래처 매칭
//   chatId   API2 방 ID. 있으면 방 제목이 바뀌어도 같은 방으로 이어진다
//   logId    API2 메시지 ID. 있으면 멱등 키로 그대로 쓴다
//   image    사진 메시지 base64(data: 접두어 없이). 텍스트 없이 사진만 있어도 받는다
// 출력: { ok, inserted, skipped, unmatched? }
//   unmatched=true 는 규칙 미매칭. 봇이 그 방을 로컬 차단 목록에 넣는 신호로도 쓴다.
//
// 방 등록 명령: text 가 "#등록 <거래처명>" · "#등록해제" 면 메시지가 아니라 명령으로 처리한다.
//   저장하지 않고 exact 규칙을 만들거나 지운다. 응답의 registered/unregistered 를 보고
//   봇이 규칙을 즉시 다시 받아가 등록 직후부터 수집이 시작된다.

export async function POST(req: Request) {
  if (!ingestTokenValid(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    room?: string;
    sender?: string;
    text?: string;
    chatId?: string;
    logId?: string;
    ts?: string;
    image?: string;
    imageName?: string;
  } | null;

  const hasImage = !!body?.image;
  if (!body?.room || !body?.sender || (!body.text && !hasImage)) {
    return NextResponse.json(
      { error: 'room, sender, 그리고 text 또는 image 가 필요합니다' },
      { status: 400 },
    );
  }

  const sb = getServerClient();
  const workspaceId = await resolveBotWorkspaceId(sb);
  if (!workspaceId) {
    // 어디에 쌓을지 모르는 상태로 받아두면 되돌리기 어렵다. 받지 않는 편이 낫다.
    return NextResponse.json(
      { error: 'KAKAO_WORKSPACE_ID 가 설정되지 않았습니다' },
      { status: 503 },
    );
  }

  // 방 등록/해제 명령은 메시지가 아니다. 매칭·저장 어느 쪽도 타지 않고 여기서 끝난다.
  const command = parseRoomCommand(body.text ?? '');
  if (command) {
    return handleRoomCommand(sb, workspaceId, command, body.room, body.sender);
  }

  // 매칭을 먼저 본다 — 미매칭 방의 사진이 버킷에 남으면 안 되기 때문.
  const matched = await matchRoomForWorkspace(sb, workspaceId, body.room);
  if (!matched) {
    await recordUnmatchedRoom(sb, workspaceId, roomKeyOf(body.chatId, body.room), body.room.trim());
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0, unmatched: true });
  }

  const attachment = hasImage
    ? await storeImage(sb, workspaceId, body.image!, body.imageName)
    : null;

  const result = await ingestBotMessage(
    {
      workspaceId,
      chatId: body.chatId,
      roomName: body.room,
      speaker: body.sender,
      text: body.text ?? '',
      logId: body.logId,
      ts: body.ts,
      attachment,
      matched,
    },
    sb,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? '저장 실패' }, { status: 500 });
  }

  await logAuditMachine({
    action: 'kakao.bot.ingest',
    targetTable: 'kakao_messages',
    targetId: result.roomId,
    meta: { inserted: result.inserted, skipped: result.skipped, room: body.room },
  });

  // 이 방으로 나갈 것이 밀려 있으면 응답에 얹어 보낸다. 거래처가 방금 말한 직후라
  // 그 방의 알림 세션이 가장 확실히 살아 있는 순간이고, 봇이 따로 물어볼 때까지
  // 기다리지 않아도 된다. 결과는 봇이 다음 outbox 호출에서 알려준다.
  const outbox = result.roomId
    ? await claimOutbound(sb, workspaceId, { roomId: result.roomId, limit: 5 })
    : [];

  return NextResponse.json({
    ok: true,
    inserted: result.inserted,
    skipped: result.skipped,
    outbox,
  });
}

/**
 * "#등록 <거래처명>" · "#등록해제" 처리.
 *
 * 봇은 이 두 메시지만 규칙 밖 방에서도 올려보낸다(bot/speciai-bot.js 의 isRoomCommand).
 * 응답의 registered/unregistered 를 보고 봇이 규칙을 즉시 다시 받아간다 —
 * 그래야 등록 직후부터 수집이 시작되고, 해제 직후부터 멈춘다(기본 갱신 주기 10분을 안 기다림).
 */
async function handleRoomCommand(
  sb: SupabaseClient,
  workspaceId: string,
  command: NonNullable<ReturnType<typeof parseRoomCommand>>,
  room: string,
  sender: string,
) {
  // 방 제목이 없는 단말에서는 room 자리에 발신자명이 온다. 그 이름으로 규칙을 만들면
  // 그 사람이 말하는 모든 방이 이 거래처로 붙어버린다. 등록·해제 모두 거부한다.
  if (normalizeRoomName(room) === normalizeRoomName(sender)) {
    await logAuditMachine({
      action: 'kakao.bot.ingest',
      targetTable: 'partner_room_rules',
      meta: { room, command: command.kind, rejected: 'no-room-title' },
    });
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: 0,
      command: command.kind,
      rejected: 'no-room-title',
    });
  }

  if (command.kind === 'unbind') {
    const result = await unbindRoom(sb, workspaceId, room);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '해제 실패' }, { status: 500 });
    }
    await logAuditMachine({
      action: 'kakao.bot.ingest',
      targetTable: 'partner_room_rules',
      meta: {
        room,
        sender,
        command: 'unbind',
        removed: result.removed,
        stillMatched: result.stillMatched,
      },
    });
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: 0,
      unregistered: true,
      removed: result.removed,
      stillMatched: result.stillMatched,
    });
  }

  const result = await bindRoomToPartner(sb, workspaceId, room, command.partnerName);

  // 대시보드에 없는 회사명 — 만들지 않는다. 방에서 친 오타로 거래처가 생기면 그 방 대화가
  // 조용히 엉뚱한 곳에 쌓인다. 대신 미분류 방에 남겨 콘솔에서 눈에 띄게 한다.
  if (result.partnerMissing) {
    await recordUnmatchedRoom(sb, workspaceId, roomKeyOf(null, room), normalizeRoomName(room));
    await logAuditMachine({
      action: 'kakao.bot.ingest',
      targetTable: 'partner_room_rules',
      meta: { room, sender, command: 'bind', rejected: 'partner-missing', tried: command.partnerName },
    });
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: 0,
      command: 'bind',
      rejected: 'partner-missing',
    });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? '등록 실패' }, { status: 500 });
  }

  await logAuditMachine({
    action: 'kakao.bot.ingest',
    targetTable: 'partner_room_rules',
    targetId: result.partnerId,
    meta: {
      room,
      sender,
      command: 'bind',
      partner: result.partnerName,
      rebindedFrom: result.rebindedFrom,
    },
  });
  return NextResponse.json({
    ok: true,
    inserted: 0,
    skipped: 0,
    registered: true,
    partner: result.partnerName,
  });
}

async function storeImage(
  sb: SupabaseClient,
  workspaceId: string,
  base64: string,
  name: string | undefined,
): Promise<{ path: string; type: string; name: string } | null> {
  try {
    const { createHash } = await import('node:crypto');
    const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const safeName = (name || 'kakao-image.jpg').replace(/[^\w.\-가-힣]/g, '_');
    // 파일명 충돌 방지 — 내용 해시 접두어. Date/Math 를 쓰지 않아 재전송해도 같은 경로가 된다.
    const prefix = createHash('md5').update(bytes).digest('hex').slice(0, 10);
    const path = `${workspaceId}/${prefix}-${safeName}`;
    const { error } = await sb.storage
      .from('kakao-attachments')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.error('[kakao] 이미지 업로드 실패', error.message);
      return null;
    }
    return { path, type: 'image', name: safeName };
  } catch (e) {
    // 사진을 못 올려도 텍스트는 저장해야 한다. 여기서 500 을 내면 봇이 전체를 재전송한다.
    console.error('[kakao] 이미지 처리 예외', e);
    return null;
  }
}
