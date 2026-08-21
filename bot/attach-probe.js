/**
 * 첨부 통로 실측 프로브 (메신저봇R · Android) — **진단 전용, 수집 없음**
 * ------------------------------------------------------------------
 * 묻는 것 하나: 카톡이 **비이미지 첨부(PDF·DOCX…)에도 알림에 content:// URI 를 싣는가.**
 *
 * 이미 확인된 것(다시 조사하지 말 것):
 *   - 메신저봇R 은 NotificationListenerService 기반이라 chat.image·imageDB 로는 바이트를
 *     못 얻는다(실측: chat.image.getBase64 길이 0, chat.getImage=null).
 *   - MessagingStyle 알림 extras 의 android.messages(Bundle[]) 각 칸에 uri·type·text·time·
 *     sender_person 이 실린다. NotificationListenerService 는 알림에 실린 URI 에 일시적
 *     읽기 권한을 받고, 그 권한은 MIME 종류를 가리지 않는다 → 사진이 열리면 PDF 도 열려야 한다.
 *   - 그 권한은 **알림이 살아 있는 동안만** 유효하다. 그래서 훅 안에서 즉시 읽는다.
 *   - android.messages 는 **마지막 한 건만** 본다. 카톡은 그 방의 최근 메시지 여러 건을 함께
 *     싣기 때문에, 배열을 훑으면 직전 첨부를 새 메시지에 다시 붙이게 된다(2026-08-14 버그).
 *
 * 이 파일이 하는 일 / 안 하는 일:
 *   한다   알림 훅에서 마지막 메시지 번들의 uri·type·원본 파일명을 읽고, 스트림을 끝까지
 *          읽어 **바이트 수만** 센 뒤 버린다. 로그 한 줄로 남긴다.
 *   안 한다 서버 전송(이 파일에는 네트워크 코드가 아예 없다) · 파일 저장 · 카톡방 발신 ·
 *          기존 speciai-bot.js 수집 경로 접촉.
 *
 * 설치:
 *   1) 메신저봇R → 봇 새로 만들기(이름 예: attach-probe) → 이 파일 전체 붙여넣기 → 컴파일 ON
 *   2) 기존 speciai-bot 은 켜둔 채로 둔다. 두 봇이 같은 알림을 각자 받는다(프로브는 로그만).
 *   3) 힌트를 **비운 채로** 한 번 켜서 시험방에 아무 텍스트나 보낸다. 로그의 room=방#<번호> 를
 *      확인해 그 번호를 PROBE_ROOM_HINTS 에 넣고 다시 컴파일한 뒤 본시험을 한다.
 *      (이 단말은 알림에 방 제목이 안 실린다 — 거를 수 있는 것은 이 열쇠뿐이다. 아래 참조)
 *   4) 시험이 끝나면 PROBE = false 로 되돌리고 봇을 끈다.
 *
 * 시험 절차(이 순서 그대로, 각 건 사이 10초 이상):
 *   1 텍스트 1건        음성 대조군 — last.uri=없음 이 나와야 정상
 *   2 사진 1장          양성 대조군 — 알림 경로 자체가 살아 있는지
 *   3 PDF 1개(1MB 미만)
 *   4 DOCX 1개
 *   5 PDF 1개(5MB 이상) 상한 넘는 파일도 URI·이름은 오는지
 *
 * 판정:
 *   PASS    3~4 에서 last.uri=있음 · type=application/pdf 등 · bytes=실제 크기
 *   권한문제 uri 는 있는데 openInputStream 이 null/예외 → 원인 규명 필요
 *   FAIL    2 는 uri=있음인데 3~4 만 uri=없음 → 카톡이 파일 메시지에 URI 를 안 싣는다
 *   무효    2(사진)조차 uri=없음 → 알림 접근 권한·카톡 알림 설정부터 확인 후 재시험
 */

// ── 스위치 ────────────────────────────────────────────────────

/** 시험이 끝나면 false. false 면 훅을 아예 등록하지 않는다(로그 한 줄만 남긴다). */
var PROBE = true;

/**
 * 이 문자열 중 하나가 알림의 **방 열쇠**·발신자·(있다면)방 제목·본문에 들어 있을 때만 첨부를 연다.
 * 비워두면 전부 연다 — 개인 카톡의 사진·문서까지 단말 메모리를 거치게 되므로 권장하지 않는다.
 *
 * ⚠️ 이 단말은 알림에 방 제목이 안 실린다(conversationTitle·hiddenConversationTitle 전부 빈 값,
 *    android.title 은 발신자명). 그래서 실제로 쓸 수 있는 열쇠는 threadId/chatId 로 만든
 *    "방#<번호>" 다 — 본체 봇이 room_key 로 쓰는 것과 같은 번호다.
 *    예: ['475692986962464']  또는 1:1·시험 상대 이름 ['홍길동']
 */
var PROBE_ROOM_HINTS = [];

/** 바이트를 끝까지 세는 상한. 넘으면 '>N' 으로 남기고 멈춘다(5MB 시험용으로 여유 있게). */
var PROBE_MAX_BYTES = 64 * 1024 * 1024;

/** 카톡은 같은 알림을 다시 올린다. 같은 서명은 이 시간 안에서 한 번만 찍는다. */
var PROBE_DEDUPE_MS = 20 * 1000;

var _probeLast = '';
var _probeLastAt = 0;

// ── 유틸 ──────────────────────────────────────────────────────

function pCtx() {
  try { if (typeof App !== 'undefined' && App.getContext) return App.getContext(); } catch (e) {}
  try { if (typeof Api !== 'undefined' && Api.getContext) return Api.getContext(); } catch (e2) {}
  return null;
}

function pStr(ex, key) {
  try {
    var v = ex.get(key);
    if (v === null || v === undefined) return '';
    var s = String(v);
    return (s === 'null') ? '' : s;
  } catch (e) { return ''; }
}

function pIsSummary(sbn) {
  try {
    var FLAG_GROUP_SUMMARY = 0x00000200;
    return (sbn.getNotification().flags & FLAG_GROUP_SUMMARY) !== 0;
  } catch (e) { return false; }
}

function pNow() { return new Date().getTime(); }

/**
 * 이 알림이 어느 방인지. **본체 봇의 notiRoomKeyOf 와 같은 순서**로 뽑는다 —
 * 여기서 찍힌 번호가 곧 서버의 room_key("name:방#<번호>")이므로, 로그 줄과 대시보드의
 * 방을 사람이 직접 맞춰볼 수 있다. 순서를 바꾸면 그 대응이 깨진다.
 */
function pRoomKeyOf(sbn, ex) {
  var candidates = [];
  candidates.push(pStr(ex, 'threadId'));
  candidates.push(pStr(ex, 'chatId'));
  try { candidates.push(String(sbn.getTag() || '')); } catch (e) {}
  try { candidates.push(String(sbn.getId())); } catch (e2) {}

  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    if (!v || v === '0' || v === 'null' || v === 'undefined') continue;
    return v;
  }
  try {
    var k = String(sbn.getKey() || '');
    if (k) return k.replace(/\|/g, '-');
  } catch (e3) {}
  return '';
}

/** content:// 의 원본 파일명(OpenableColumns.DISPLAY_NAME). 못 읽으면 사유 문자열. */
function pDisplayName(uri) {
  var ctx = pCtx();
  if (ctx === null) return 'context=null';
  var cur = null;
  try {
    cur = ctx.getContentResolver().query(uri, null, null, null, null);
    if (cur === null) return 'query=null';
    if (!cur.moveToFirst()) return 'query=빈행';
    var idx = cur.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
    if (idx < 0) return 'DISPLAY_NAME=없음';
    var v = cur.getString(idx);
    return (v === null || v === undefined) ? '' : String(v);
  } catch (e) {
    return 'query=err(' + e + ')';
  } finally {
    if (cur !== null) { try { cur.close(); } catch (e2) {} }
  }
}

/**
 * 스트림을 끝까지 읽어 **바이트 수만** 센다. 내용은 버린다(어디에도 담지 않는다).
 * 반환은 로그에 그대로 넣을 문자열 — 숫자이거나 실패 사유다.
 */
function pCountBytes(uri) {
  var ctx = pCtx();
  if (ctx === null) return 'context=null';
  var stream = null;
  var t0 = pNow();
  try {
    stream = ctx.getContentResolver().openInputStream(uri);
    if (stream === null) return 'openInputStream=null';
    var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var total = 0;
    var n = stream.read(buf);
    while (n > 0) {
      total += n;
      if (total > PROBE_MAX_BYTES) return '>' + PROBE_MAX_BYTES;
      n = stream.read(buf);
    }
    return String(total) + '(' + (pNow() - t0) + 'ms)';
  } catch (e) {
    return 'err(' + e + ')';
  } finally {
    if (stream !== null) { try { stream.close(); } catch (e2) {} }
  }
}

/** 힌트가 비어 있으면 전부 통과. 아니면 방 이름·발신자·본문 중 하나에 걸릴 때만. */
function pInScope(hay) {
  if (PROBE_ROOM_HINTS.length === 0) return true;
  for (var i = 0; i < PROBE_ROOM_HINTS.length; i++) {
    var h = PROBE_ROOM_HINTS[i];
    if (h && hay.indexOf(h) >= 0) return true;
  }
  return false;
}

// ── 훅 ────────────────────────────────────────────────────────

function probeNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (ep) {}
    if (pkg.indexOf('kakao') < 0) return;
    if (pIsSummary(sbn)) return;

    var ex = sbn.getNotification().extras;

    var title = pStr(ex, 'android.title');          // 이 단말에선 발신자명이다
    var convo = pStr(ex, 'android.conversationTitle')
      || pStr(ex, 'android.hiddenConversationTitle');
    var body = pStr(ex, 'android.text') || pStr(ex, 'android.bigText');

    if (!pInScope(title + ' ' + convo + ' ' + body)) return;

    var arr = null;
    try { arr = ex.get('android.messages'); } catch (eA) { arr = null; }
    if (arr === null || arr === undefined || arr.length === 0) {
      Log.i('probe: msgs=0 last.uri=없음 type=- name=- bytes=- 앞선첨부=0'
        + ' | title="' + title + '" body=' + (body ? body.length + '자' : '없음'));
      return;
    }

    var last = arr[arr.length - 1];
    var lastUri = null, lastType = null, lastText = '', lastTime = '';
    try { lastUri = last.get('uri'); } catch (e1) {}
    try { lastType = last.get('type'); } catch (e2) {}
    try { var lt = last.get('text'); if (lt !== null && lt !== undefined) lastText = String(lt); } catch (e3) {}
    try { var tm = last.get('time'); if (tm !== null && tm !== undefined) lastTime = String(tm); } catch (e4) {}

    // 마지막을 제외한 앞선 건들 중 uri 를 가진 수. 0 이 아니면 "직전 첨부가 다시 실려 온" 것이니
    // 배열을 훑는 구현으로 되돌아가면 안 된다는 증거다.
    var older = 0;
    for (var i = 0; i < arr.length - 1; i++) {
      try {
        var b = arr[i];
        if (b && b.get && b.get('uri') !== null && b.get('uri') !== undefined) older++;
      } catch (e5) {}
    }

    // 같은 알림 재게시로 같은 줄이 반복되는 것을 막는다(판정표를 읽을 수 없게 된다).
    var sig = String(lastTime) + '|' + lastText.length + '|' + (lastUri === null || lastUri === undefined ? '' : String(lastUri));
    if (sig === _probeLast && (pNow() - _probeLastAt) < PROBE_DEDUPE_MS) return;
    _probeLast = sig;
    _probeLastAt = pNow();

    var hasUri = (lastUri !== null && lastUri !== undefined);
    var name = '-';
    var bytes = '-';
    var uriStr = '-';

    if (hasUri) {
      var u = (typeof lastUri === 'string') ? android.net.Uri.parse(lastUri) : lastUri;
      uriStr = String(u);
      // 권한은 알림이 살아 있는 동안만이다 — 여기서 즉시 읽는다.
      name = pDisplayName(u);
      bytes = pCountBytes(u);
    }

    Log.i('probe: msgs=' + arr.length
      + ' last.uri=' + (hasUri ? '있음' : '없음')
      + ' type=' + (lastType === null || lastType === undefined ? '없음' : String(lastType))
      + ' name=' + (name === '' ? '(빈값)' : name)
      + ' bytes=' + bytes
      + ' 앞선첨부=' + older
      + ' | title="' + title + '" convo="' + convo + '"'
      + ' last.text=' + (lastText ? lastText.length + '자' : '없음')
      + (hasUri ? ' uri=' + uriStr : ''));
  } catch (e) {
    Log.e('probe: 예외 — ' + e);
  }
}

// ── 환경 표기 (보고서에 그대로 옮길 값) ───────────────────────

function probeEnvLine() {
  var parts = [];
  try { parts.push('android=' + String(android.os.Build.VERSION.RELEASE) + '(sdk' + android.os.Build.VERSION.SDK_INT + ')'); } catch (e1) { parts.push('android=?'); }
  try { parts.push('device=' + String(android.os.Build.MANUFACTURER) + ' ' + String(android.os.Build.MODEL)); } catch (e2) {}
  var ctx = pCtx();
  if (ctx !== null) {
    var pm = null;
    try { pm = ctx.getPackageManager(); } catch (e3) {}
    if (pm !== null) {
      try { parts.push('kakaotalk=' + String(pm.getPackageInfo('com.kakao.talk', 0).versionName)); } catch (e4) { parts.push('kakaotalk=조회실패'); }
      try { parts.push('messengerbot=' + String(pm.getPackageInfo(String(ctx.getPackageName()), 0).versionName) + '(' + String(ctx.getPackageName()) + ')'); } catch (e5) { parts.push('messengerbot=조회실패'); }
    }
  } else {
    parts.push('context=null');
  }
  return parts.join(' ');
}

// ── 진입점 ────────────────────────────────────────────────────

Log.i('probe: 첨부 프로브 v2026-08-21 PROBE=' + PROBE
  + ' hints=' + (PROBE_ROOM_HINTS.length === 0 ? '(없음 — 전체 방)' : PROBE_ROOM_HINTS.join(',')));
Log.i('probe: env ' + probeEnvLine());

if (PROBE) {
  var _pbot = null;
  try {
    if (typeof BotManager !== 'undefined' && BotManager.getCurrentBot) {
      _pbot = BotManager.getCurrentBot();
    }
  } catch (e) {
    Log.e('probe: BotManager 접근 실패 — ' + e);
  }

  if (_pbot !== null && _pbot.on) {
    try {
      _pbot.on(Event.NOTIFICATION_POSTED, probeNoti);
      Log.i('probe: NOTIFICATION_POSTED 등록 성공 (API2)');
    } catch (e2) {
      Log.e('probe: NOTIFICATION_POSTED 등록 실패 — ' + e2);
    }
  } else {
    Log.e('probe: API2 미활성 — 구 API onNotificationPosted 로 동작');
  }
} else {
  Log.i('probe: PROBE=false — 훅을 등록하지 않는다');
}

// 구 API 폴백. API2 등록이 됐어도 이 훅이 함께 불리는 단말이 있는데, 위 dedupe 가 같은 줄을
// 두 번 찍는 것을 막는다.
function onNotificationPosted(sbn, sm) {
  if (!PROBE) return;
  probeNoti(sbn);
}
