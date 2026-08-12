/**
 * 거래처 카톡 수집 봇 (메신저봇R · Android)
 * ------------------------------------------------------------------
 * 이 스크립트는 메신저봇R(Android) 앱에 등록해 업무 전용 단말에서 실행한다.
 * 봇 계정을 거래처 단톡방에 초대하면, 그 방 메시지를 서버로 보낸다.
 *
 * ★ 이 봇이 방에 쓰는 것은 대시보드에서 사람이 쓴 글뿐이다(발신 큐).
 *   자동응답·자동인사·자동확인은 없다. 사람이 누르지 않으면 이 봇은 한 글자도 쓰지 않는다.
 *   자동응답을 넣지 않는 이유는 카카오의 자동화 탐지다 — 기계적 응답 패턴이 계정 정지를
 *   부르고, 정지되면 수집까지 함께 멈춘다. 발신에 4초 이상 간격과 무작위 지연을 두는 것도
 *   같은 이유다.
 *
 * ★ 개인 카톡 보호 — 거르는 곳은 지금 **서버**다(DEVICE_FILTER=false, 2026-08-12 대표 지시).
 *   이 폰에 오는 카톡을 전부 올리고, 서버가 규칙에 걸리는 방만 저장한다. 규칙 밖 방은
 *   본문 없이 방 이름·수신 횟수만 남고 버려진다(api/kakao/bot/ingest 가 매칭을 먼저 본다).
 *   사진만은 예외로 단말에서 먼저 거른다(PHOTO_ONLY_FROM_KNOWN_ROOMS) — 장당 3MB 를
 *   올려봐야 서버가 버린다.
 *   DEVICE_FILTER=true 로 되돌리면 예전처럼 단말이 규칙에 있는 방만 올린다.
 *
 * ★ 방 등록 — 카톡방 안에서 켜고 끈다.
 *     #등록 삼성전자   이 방을 그 거래처에 붙인다. 이후 대화가 수집된다.
 *                    거래처는 대시보드에 미리 등록돼 있어야 한다 — 없으면 거부된다.
 *     #등록해제        이 방의 수집을 멈춘다. 이미 저장된 대화는 지워지지 않는다.
 *   이 두 메시지만 규칙 밖 방에서도 서버로 올라간다. 서버는 저장하지 않고 규칙만 고친다.
 *   카톡에서 방 제목을 지정해 두어야 한다 — 제목이 없으면 등록이 거부된다.
 *
 * ★ 전제(반드시 확인): 각 거래처 방 참여자에게 "메시지가 자동 수집·저장된다"는 사실을
 *   사전 고지·동의받을 것(개인정보보호법 §15). 동의 없는 방 수집 금지.
 *
 * 서버 배선:
 *   GET  {RULES_ENDPOINT} 헤더 X-Ingest-Token: {TOKEN}
 *        → { version, rules: [{ kind, pattern }] }  연결된 방 목록
 *   POST {ENDPOINT}       헤더 X-Ingest-Token: {TOKEN}
 *        → { room, sender, text, ts, chatId?, logId?, image?, imageName? }
 *          ts 는 단말이 메시지를 받은 시각. 재전송으로 늦게 도착해도 원래 시각으로 남는다.
 *        ← { ok, inserted, skipped, unmatched?, registered?, unregistered?, outbox? }
 *          registered/unregistered 가 오면 규칙을 즉시 다시 받아온다.
 *          outbox 가 실려 오면 그 방으로 나갈 발신 건이다(거래처가 방금 말한 방이라 세션이 확실).
 *   POST {OUTBOX_ENDPOINT} 헤더 X-Ingest-Token: {TOKEN}
 *        → { acks: [{ id, ok, error? }] }   직전에 보낸 것들의 결과
 *        ← { ok, outbox: [{ id, room, text }] }  보낼 것
 *
 * 설치:
 *   1) Play스토어 "메신저봇R" 설치 → 알림 접근 권한·배터리 최적화 해제 허용
 *   2) 봇 새로 만들기 → 이 파일 내용 전체 붙여넣기(기존 코드 싹 지우고)
 *   3) 아래 설정 4줄 채우기 → 컴파일 ON → 봇 계정으로 거래처 방 초대 → 방에서 #등록
 *
 * ※ API2(BotManager + Event.MESSAGE) 우선. v0.7.29a 이상에서 동작한다.
 *   메신저봇R 은 알림 파싱 기반이라 단말에 따라 방 제목 대신 발신자명이 오는 경우가 있다.
 *   그 상태로는 규칙 매칭이 불가능하므로 알림 원본을 직접 읽어 방 제목·발신자를 복원한다
 *   (notiRoomOf·notiSenderOf). API2 가 없는 단말에서는 발신도 알림의 RemoteInput 으로 나간다.
 */

// ── 설정 (여기 3줄만 채우면 됨) ────────────────────────────────
//
// ⚠️ TOKEN 을 채운 파일은 커밋하지 말 것. 이 파일은 플레이스홀더 상태로만 저장소에 둔다.
//    값을 채워 보관하려면 bot/speciai-bot.local.js 로 복사해서 쓴다(.gitignore 처리됨).
//    실제 단말에는 메신저봇R 앱에 직접 붙여넣으므로 저장소에 채운 사본을 둘 이유가 없다.
var ENDPOINT = 'https://<배포도메인>/api/kakao/bot/ingest';
var RULES_ENDPOINT = 'https://<배포도메인>/api/kakao/bot/rules';
var OUTBOX_ENDPOINT = 'https://<배포도메인>/api/kakao/bot/outbox';
var TOKEN = '<KAKAO_INGEST_TOKEN>'; // 서버 env KAKAO_INGEST_TOKEN 과 같은 값

// ── 동작 옵션 ─────────────────────────────────────────────────

/**
 * ⚠️ 단말 선필터. **끈 상태다**(2026-08-12 대표 지시 — kakao-advisor-bot 과 같은 방식).
 *
 * false 면 이 폰에 오는 카톡을 전부 서버로 보내고, 무엇을 남길지는 서버가 정한다.
 * 서버는 규칙 밖 방의 **본문을 저장하지 않는다** — 매칭을 먼저 보고 미매칭이면 방 이름과
 * 수신 횟수만 `kakao_unmatched_rooms` 에 남기고 버린다(`api/kakao/bot/ingest`).
 * 그래도 개인 대화가 전송 구간을 지나가고, 미분류 방 목록에 개인 카톡방 이름(사람 이름)이
 * 쌓인다. 그걸 감수하고 켠 것이니 "왜 개인 방이 목록에 뜨냐" 로 되돌리지 말 것.
 *
 * true 로 되돌리면 예전처럼 단말이 규칙에 있는 방만 올린다. 그 한 줄이면 된다.
 */
var DEVICE_FILTER = false;

/**
 * 사진만은 선필터를 꺼도 규칙에 있는 방에서만 올린다.
 *
 * 사진 1장이 base64 로 최대 3MB 다. 전부 올리면 데이터·배터리를 그대로 태우는데, 서버는
 * 업로드 전에 매칭을 먼저 보므로 규칙 밖 방의 사진은 **어차피 버려진다**. 비용만 들고
 * 얻는 것이 없다. 텍스트와 달리 진단에도 쓸모가 없다.
 */
var PHOTO_ONLY_FROM_KNOWN_ROOMS = true;

var HANDLE_GROUP_ONLY = false;      // true 면 단톡방만. 일부 단말이 단톡방을 1:1 로 넘겨 기본은 false.
var SEND_TIMEOUT_MS = 8000;
var RULES_REFRESH_MS = 10 * 60 * 1000;  // 규칙 갱신 주기(10분)
var RULES_CACHE_FILE = 'sq-kakao-rules.json'; // 앱 재시작 후에도 규칙을 유지하기 위한 캐시

// 대시보드 발신. false 로 두면 이 봇은 예전처럼 읽기만 한다.
var OUTBOX_ENABLED = true;
var OUTBOX_POLL_MS = 15000;    // "보낼 것 있나" 를 물어보는 주기

// 알림에 뭐가 실려오는지 매번 로그로 남긴다. 방 제목 복원이 안 될 때 원인을 보려는 것이라
// 확인이 끝나면 false 로 되돌린다(로그가 계속 쌓인다). 본문은 길이만 남는다.
var NOTI_DEBUG = true;

/**
 * 알림 훅에서 곧바로 수집한다(메신저봇R 의 response 콜백과 병행).
 *
 * 두 경로는 서로 독립된 이벤트라 순서가 보장되지 않는다. response 가 먼저 오면 그 시점에
 * 아직 알림 기록이 없어 방 제목을 못 붙이고, 그대로 버려진다 — #등록 이 "가끔" 안 먹던
 * 정체가 이것이다. 알림 자체에 방 제목·발신자·본문이 다 들어 있으므로 알림 쪽에서 바로
 * 처리하면 순서에 의존하지 않는다.
 *
 * 같은 메시지가 두 번 올라가지 않는 근거는 단말의 _claimMessage(20초 창)이고,
 * 그것이 새더라도 서버 멱등키(room_id, content_hash)가 한 번 더 막는다.
 */
var NOTI_INGEST = true;

// 구 API 콜백이 알림 훅에 양보하는 시간. 알림 훅은 방 이름을 제대로 붙이고 구 API 는 못 붙인다.
var RESPONSE_YIELD_MS = 600;
var SEND_MIN_GAP_MS = 4000;    // 연속 발신 최소 간격. 기계적 연타는 자동화로 탐지된다
var SEND_JITTER_MS = 1200;     // 그 위에 얹는 무작위 지연 — 간격이 일정하면 그것도 기계 신호다

/** 규칙 캐시 파일 경로. 큐와 같은 쓰기 가능 디렉터리를 쓴다. */
function rulesCachePath() {
  var prefix = probeFilePrefix();
  return (prefix === null) ? null : prefix + RULES_CACHE_FILE;
}

function _now() { return java.lang.System.currentTimeMillis(); }

/**
 * 지금 시각을 ISO 8601(UTC)로. Rhino 의 Date#toISOString 유무가 버전마다 달라
 * Java 포맷터를 먼저 쓴다. 타임존을 UTC 로 고정하고 'Z' 를 직접 붙이는 이유는
 * SimpleDateFormat 의 Z 패턴이 "+0900" 을 내놓아 서버 파싱이 애매해지기 때문이다.
 */
function isoFromMillis(ms) {
  try {
    var fmt = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS");
    fmt.setTimeZone(java.util.TimeZone.getTimeZone('UTC'));
    return String(fmt.format(new java.util.Date(ms))) + 'Z';
  } catch (e) {
    try { return new Date(ms).toISOString(); } catch (e2) { return ''; }
  }
}

function nowIso() {
  return isoFromMillis(_now());
}

// ── 규칙 (서버에서 내려받음) ──────────────────────────────────
var _rules = [];          // [{ kind, pattern }]
var _rulesVersion = '';
var _rulesFetchedAt = 0;
var _rulesEverLoaded = false;

function trimText(msg) {
  if (msg === null || msg === undefined) return '';
  return String(msg).replace(/^\s+|\s+$/g, '');
}

/** 방 이름 정규화 — 서버 src/server/kakao/rules.ts 의 normalizeRoomName 과 같아야 한다. */
function normRoom(name) {
  if (name === null || name === undefined) return '';
  return String(name).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

/**
 * 규칙 1건 매칭 — 서버 ruleMatches 와 같은 결과를 내야 한다.
 * 여기와 서버가 어긋나면 "단말은 보냈는데 서버가 버리는" 방이 생긴다.
 */
function ruleMatches(rule, roomName) {
  var room = normRoom(roomName);
  var pattern = normRoom(rule.pattern);
  if (!room || !pattern) return false;

  var r = room.toLowerCase();
  var p = pattern.toLowerCase();

  if (rule.kind === 'prefix') return r.indexOf(p) === 0;
  if (rule.kind === 'exact') return r === p;
  if (rule.kind === 'contains') return r.indexOf(p) >= 0;
  if (rule.kind === 'regex') {
    try { return new RegExp(pattern, 'i').test(room); } catch (e) { return false; }
  }
  return false;
}

/** 이 방을 서버로 보내도 되는가. 규칙이 하나도 없으면 무조건 false(fail-closed). */
function isAllowedRoom(roomName) {
  if (!_rules || _rules.length === 0) return false;
  for (var i = 0; i < _rules.length; i++) {
    if (ruleMatches(_rules[i], roomName)) return true;
  }
  return false;
}

/**
 * 방 등록 명령인가. 서버 src/server/kakao/commands.ts 의 parseRoomCommand 와 같은 결과를 내야 한다.
 * 어긋나면 단말이 통과시킨 명령을 서버가 일반 메시지로 저장해버린다.
 *
 * 규칙 밖 방에서 단말 밖으로 나가는 것은 이 두 종류뿐이다. 조건을 넓히지 말 것 —
 * 넓히는 순간 개인 카톡이 서버에 도달한다.
 */
function isRoomCommand(text) {
  if (!text) return false;
  var t = String(text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (t === '#등록해제') return true;
  return /^#등록\s+.+$/.test(t);
}

// 규칙 캐시도 큐와 같은 경로 탐색을 쓴다. 이 단말에서 상대경로 FileStream.write 가
// NPE 를 내는 것을 확인했고, 그때마다 예외 로그만 찍고 넘어가면 재시작 후 규칙이 없어
// 서버에 닿기 전까지 아무것도 수집하지 못한다(fail-closed 라 유실은 아니지만 공백이 생긴다).
function readCachedRules() {
  var raw = fileRead(rulesCachePath());
  if (!raw) return;
  try {
    var obj = JSON.parse(raw);
    if (obj && obj.rules && obj.rules.length) {
      _rules = obj.rules;
      _rulesVersion = obj.version || '';
      _rulesEverLoaded = true;
      Log.i('kakao-bot: 캐시 규칙 ' + _rules.length + '건 로드 (v' + _rulesVersion + ')');
    }
  } catch (e) {
    Log.e('kakao-bot: 규칙 캐시가 깨졌다 — 무시하고 서버에서 받는다');
  }
}

function writeCachedRules() {
  var path = rulesCachePath();
  if (path === null) return; // 쓸 수 있는 경로가 없다. 조용히 넘어간다(이미 시작 로그에 남았다)
  fileWrite(path, JSON.stringify({ version: _rulesVersion, rules: _rules }));
}

/**
 * 서버에서 규칙을 받아온다. 실패해도 기존 규칙을 지우지 않는다 —
 * 네트워크가 잠깐 끊겼다고 수집이 멈추면 그동안의 메시지를 통째로 잃는다.
 */
function refreshRules(force) {
  var now = _now();
  if (!force && _rulesFetchedAt && (now - _rulesFetchedAt) < RULES_REFRESH_MS) return;
  _rulesFetchedAt = now;

  var conn = null;
  try {
    var url = new java.net.URL(RULES_ENDPOINT);
    conn = url.openConnection();
    conn.setRequestMethod('GET');
    conn.setConnectTimeout(SEND_TIMEOUT_MS);
    conn.setReadTimeout(SEND_TIMEOUT_MS);
    conn.setRequestProperty('X-Ingest-Token', TOKEN);

    var code = conn.getResponseCode();
    if (code !== 200) {
      Log.e('kakao-bot: 규칙 조회 실패 code=' + code);
      return;
    }
    var reader = new java.io.BufferedReader(
      new java.io.InputStreamReader(conn.getInputStream(), 'UTF-8'));
    var body = '';
    var line;
    while ((line = reader.readLine()) !== null) body += line;
    reader.close();

    var obj = JSON.parse(body);
    if (!obj || !obj.rules) return;
    if (obj.version && obj.version === _rulesVersion) {
      _rulesEverLoaded = true;
      return; // 내용이 그대로면 갈아끼우지 않는다.
    }
    _rules = obj.rules;
    _rulesVersion = obj.version || '';
    _rulesEverLoaded = true;
    writeCachedRules();
    Log.i('kakao-bot: 규칙 ' + _rules.length + '건 갱신 (v' + _rulesVersion + ')');
  } catch (e) {
    Log.e('kakao-bot: 규칙 조회 예외 — ' + e);
  } finally {
    if (conn !== null) { try { conn.disconnect(); } catch (e2) {} }
  }
}

// ── 이미지 추출 ───────────────────────────────────────────────
// 단말·API 버전마다 사진 base64 를 꺼내는 경로가 달라 순서대로 시도한다.
//
// 실측(2026-08-11): 이 단말에서 사진을 보내면 본문에 "사진을 보냈습니다" 만 오고
// 이미지가 붙지 않는다. 메신저봇R 은 알림 파싱 기반이라 알림에 없는 바이트는 줄 수 없고,
// 구 API 의 imageDB 는 버전에 따라 아예 없다. advisor 쪽도 같은 상태로 남아 있다
// (kakao-advisor-bot/docs/S21_봇_셋업가이드.md: "사진·파일은 현재 미구현").
//
// 그래서 어느 경로가 무엇을 주는지 로그로 남긴다. 없는 경로인지, 있는데 null 인지,
// 있는데 예외가 나는지가 구분되지 않으면 고칠 수 있는지조차 알 수 없다.
var _lastImgTried = '';  // 마지막 사진 추출 시도 내역(경로별 결과). 최종 실패 로그에만 쓴다.

function extractImage(chat, imageDB, bodyLooksLikePhoto) {
  var out = null;
  var tried = [];
  function tryGet(label, fn) {
    if (out) return;
    try {
      var v = fn();
      tried.push(label + '=' + (v === null || v === undefined ? 'null' : String(v).length));
      if (v && String(v).length > 100) out = String(v);
    } catch (e) {
      tried.push(label + '=err');
    }
  }

  if (chat) {
    tryGet('chat.image.getBase64', function () {
      if (chat.image && chat.image.getBase64) return chat.image.getBase64();
      return null;
    });
    tryGet('chat.getImage.getBase64', function () {
      if (chat.getImage) {
        var im = chat.getImage();
        if (im && im.getBase64) return im.getBase64();
      }
      return null;
    });
  }
  if (imageDB) {
    tryGet('imageDB.getImageBase64', function () {
      if (imageDB.getImageBase64) return imageDB.getImageBase64();
      return null;
    });
    tryGet('imageDB.getImage', function () {
      if (imageDB.getImage) return imageDB.getImage();
      return null;
    });
  }

  // 진단 문구만 남겨두고 여기서 로그를 찍지는 않는다. 실측 결과 이 경로들은 이 단말에서
  // 전부 빈 값을 주고(imageDB.getImageBase64=0), 실제 사진은 알림 폴백이 가져온다.
  // 여기서 "실패" 를 찍으면 성공한 케이스마다 오해를 부르는 에러 로그가 남는다.
  _lastImgTried = 'imageDB=' + (imageDB ? '있음' : '없음')
    + ' [' + (tried.length ? tried.join(' ') : '경로없음') + ']';
  return out;
}

/** 사진을 결국 못 구했을 때만 한 번 남긴다. 두 경로(메신저봇R·알림)를 다 거친 뒤 부른다. */
function logPhotoMiss(where) {
  Log.e('kakao-bot[' + where + '] 사진 최종 실패 — ' + _lastImgTried + ' + 알림폴백 없음');
}

/** 본문이 카톡의 사진 알림 문구인가. 추출 실패 진단을 사진일 때만 찍기 위한 판정. */
function looksLikePhoto(text) {
  if (!text) return false;
  var t = trimText(text);
  return t.indexOf('사진') === 0 || t.indexOf('이미지') === 0 || t.indexOf('보냈습니다') >= 0;
}

// ── 실패 재전송 큐 ────────────────────────────────────────────
//
// 서버가 못 받은 메시지를 여기 쌓아두고 다음 기회에 다시 보낸다. 이게 없으면 폰 네트워크가
// 잠깐 끊긴 것만으로 거래처 발주 내용이 영구히 사라지고, 사라졌다는 사실조차 남지 않는다.
//
// 파일에 쌓는 것이 원칙이다 — 앱 재시작을 견뎌야 밤새 끊긴 경우를 복구할 수 있다.
//
// 실측: 이 단말은 FileStream 이 상대경로·/sdcard 어디에도 쓰지 못한다(NPE). Android 11+
// 범위 지정 저장 때문에 외부 저장소는 권한 없이 못 쓴다. 그래서 **앱 전용 디렉터리**를
// 첫 후보로 둔다 — getFilesDir() 은 어떤 권한도 없이 항상 쓸 수 있다.
// 그리고 FileStream 이 실패하면 순수 Java IO 로 한 번 더 시도한다(NPE 가 FileStream 쪽
// 구현 문제일 수 있어서다). 둘 다 안 되면 메모리 큐로 내려간다.
var EXTRA_FILE_PREFIXES = ['', '/sdcard/msgbot/', '/storage/emulated/0/msgbot/'];
var QUEUE_FILE = 'sq-kakao-queue.json';
var PROBE_FILE = 'sq-kakao-probe.txt';
/** 큐 상한. 넘으면 오래된 것부터 버린다 — 무한히 쌓여 폰을 채우는 쪽이 더 나쁘다. */
var QUEUE_MAX = 300;

var _queue = [];         // 파일을 못 쓸 때의 메모리 큐
var _filePrefix = null;  // 쓸 수 있는 디렉터리. null 이면 메모리 큐
var _fileProbed = false;
var _flushing = false;   // flushQueue 재진입 방지

function fileWrite(path, text) {
  if (path === null) return false;
  try {
    if (typeof FileStream !== 'undefined') {
      FileStream.write(path, text);
      return true;
    }
  } catch (e) {}
  return javaWrite(path, text);
}

function fileRead(path) {
  if (path === null) return null;
  try {
    if (typeof FileStream !== 'undefined') {
      var raw = FileStream.read(path);
      if (raw !== null && raw !== undefined) return String(raw);
    }
  } catch (e) {}
  return javaRead(path);
}

function javaWrite(path, text) {
  var out = null;
  try {
    var f = new java.io.File(path);
    var parent = f.getParentFile();
    if (parent !== null && !parent.exists()) parent.mkdirs();
    out = new java.io.FileOutputStream(f);
    out.write(new java.lang.String(text).getBytes('UTF-8'));
    return true;
  } catch (e) {
    return false;
  } finally {
    if (out !== null) { try { out.close(); } catch (e2) {} }
  }
}

function javaRead(path) {
  var reader = null;
  try {
    var f = new java.io.File(path);
    if (!f.exists()) return null;
    reader = new java.io.BufferedReader(
      new java.io.InputStreamReader(new java.io.FileInputStream(f), 'UTF-8'));
    var acc = '';
    var line;
    while ((line = reader.readLine()) !== null) acc += line;
    return acc;
  } catch (e) {
    return null;
  } finally {
    if (reader !== null) { try { reader.close(); } catch (e2) {} }
  }
}

/** 앱 전용 저장소. 권한이 필요 없고 다른 앱이 볼 수 없어 큐를 두기에 가장 적합하다. */
function filesDirPrefix() {
  try {
    var ctx = appContext();
    if (ctx === null) return null;
    var dir = ctx.getFilesDir();
    if (dir === null) return null;
    return String(dir.getAbsolutePath()) + '/';
  } catch (e) {
    return null;
  }
}

function filePrefixCandidates() {
  var list = [];
  var priv = filesDirPrefix();
  if (priv !== null) list.push(priv);
  for (var i = 0; i < EXTRA_FILE_PREFIXES.length; i++) list.push(EXTRA_FILE_PREFIXES[i]);
  return list;
}

/**
 * 쓸 수 있는 디렉터리를 한 번만 찾는다. 어느 경로가 되는지 로그로 남긴다.
 *
 * 탐침을 별도 파일로 하는 이유: 큐 파일에 직접 써서 확인하면 앱 재시작 때 밀려 있던
 * 큐를 덮어써 날린다. 큐를 살리려고 만든 코드가 큐를 지우는 셈이 된다.
 */
function probeFilePrefix() {
  if (_fileProbed) return _filePrefix;
  _fileProbed = true;
  var candidates = filePrefixCandidates();
  for (var i = 0; i < candidates.length; i++) {
    var prefix = candidates[i];
    var probe = prefix + PROBE_FILE;
    var readBack = fileWrite(probe, 'ok') ? fileRead(probe) : null;
    if (readBack !== null && readBack.indexOf('ok') >= 0) {
      _filePrefix = prefix;
      Log.i('kakao-bot[파일] 쓰기 가능 — "' + prefix + '"');
      return _filePrefix;
    }
    Log.e('kakao-bot[파일] 쓰기 실패 — "' + prefix + '"');
  }
  Log.e('kakao-bot[파일] 쓸 수 있는 경로 없음 — 메모리 큐로 동작(앱 재시작 시 유실)');
  return null;
}

function queuePath() {
  var prefix = probeFilePrefix();
  return (prefix === null) ? null : prefix + QUEUE_FILE;
}

function queueLoad() {
  var path = queuePath();
  if (path === null) return _queue;
  var raw = fileRead(path);
  if (!raw) return [];
  try {
    var arr = JSON.parse(raw);
    return (arr && arr.length !== undefined) ? arr : [];
  } catch (e) {
    Log.e('kakao-bot[큐] 파일이 깨졌다 — 비우고 계속');
    return [];
  }
}

function queueSave(items) {
  var path = queuePath();
  if (path === null) {
    _queue = items;
    return;
  }
  if (!fileWrite(path, JSON.stringify(items))) {
    // 쓰기가 도중에 막히면 메모리로 물러난다. 여기서 조용히 버리면 큐의 의미가 없다.
    Log.e('kakao-bot[큐] 저장 실패 — 메모리 큐로 물러남');
    _filePrefix = null;
    _queue = items;
  }
}

function enqueue(obj) {
  var items = queueLoad();

  // 사진은 큐에 넣지 않는다. base64 가 수백 KB~수 MB 라 몇 건만 쌓여도 파일이 폰을 채운다.
  // 본문과 "사진이 있었다"는 사실은 남기고 이미지만 버린다.
  if (obj.image) {
    obj = buildPayloadObj(obj.room, obj.sender, obj.text, null, obj.chatId, obj.logId, obj.ts);
    Log.e('kakao-bot[큐] 사진은 제외하고 본문만 적재 — 재전송 시 이미지는 빠진다');
  }

  items.push(obj);
  while (items.length > QUEUE_MAX) {
    items.shift();
    Log.e('kakao-bot[큐] 상한 초과 — 가장 오래된 1건 버림');
  }
  queueSave(items);
  Log.i('kakao-bot[큐] 적재 — 대기 ' + items.length + '건');
}

/**
 * 밀린 것을 앞에서부터 보낸다. 하나라도 재시도 대상 실패가 나면 거기서 멈추고 남긴다 —
 * 계속 밀어붙이면 순서가 뒤섞이고, 서버가 죽은 상황에서 300번을 두드리게 된다.
 */
function flushQueue() {
  if (_flushing) return;
  var items = queueLoad();
  if (items.length === 0) return;

  _flushing = true;
  try {
    var sent = 0;
    while (items.length > 0) {
      var res = postPayload(items[0]);
      if (!res.ok && res.retry) break;
      // 성공이든 영구실패든 큐에서는 뺀다. 영구실패를 남겨두면 뒤의 것이 영원히 못 나간다.
      items.shift();
      sent++;
    }
    if (sent > 0) {
      queueSave(items);
      Log.i('kakao-bot[큐] ' + sent + '건 재전송 완료 — 남은 ' + items.length + '건');
    }
  } finally {
    _flushing = false;
  }
}

// ── 전송 가능 확인 (임시 진단) ────────────────────────────────
//
// 대시보드에서 쓴 글을 카톡방에 내보내려면 메신저봇R 의 전송이 이 단말에서 실제로 되는지
// 부터 알아야 한다. 메신저봇R 의 전송은 알림에 실린 RemoteInput 세션으로 나가는데,
// 단말·카톡 버전에 따라 아예 동작하지 않거나 세션이 금방 만료된다.
//
// 등록된 방에서 "#전송테스트" 를 치면 서버로 보내지 않고 단말에서만 네 경로를 시도한다.
//   ① 이벤트 replier  ② bot.send(room)  ③ Api.replyRoom(room)  ④ 알림 RemoteInput
// 60초 뒤 같은 방에 한 번 더 보낸다. 이 두 번째가 나가야 "방이 조용한 동안에도 발신 가능",
// 즉 대시보드에서 아무 때나 쓸 수 있다는 뜻이 된다. 안 나가면 거래처가 말을 건 직후에만
// 나가는 구조가 된다. 확인이 끝나면 이 블록은 지운다.
var PROBE_CMD = '#전송테스트';
var PROBE_DELAY_MS = 60000;

function probeSendOnce(room, reply, tag) {
  var out = [];

  try {
    if (reply) {
      var r1 = reply('[전송테스트' + tag + '] ① replier');
      out.push('replier=OK(' + r1 + ')');
    } else {
      out.push('replier=없음');
    }
  } catch (e1) { out.push('replier=ERR ' + e1); }

  try {
    if (_bot && _bot.send) {
      var can = '?';
      try { if (_bot.canReply) can = String(_bot.canReply(room)); } catch (eC) {}
      var r2 = _bot.send(room, '[전송테스트' + tag + '] ② bot.send');
      out.push('bot.send=OK(' + r2 + ') canReply=' + can);
    } else {
      out.push('bot.send=없음');
    }
  } catch (e2) { out.push('bot.send=ERR ' + e2); }

  try {
    if (typeof Api !== 'undefined' && Api.replyRoom) {
      var r3 = Api.replyRoom(room, '[전송테스트' + tag + '] ③ Api.replyRoom');
      out.push('Api.replyRoom=OK(' + r3 + ')');
    } else {
      out.push('Api.replyRoom=없음');
    }
  } catch (e3) { out.push('Api.replyRoom=ERR ' + e3); }

  // ④ 알림의 RemoteInput. API2 도 없고 메신저봇R 이 방 제목도 모르는 단말에서는 이것만 남는다.
  try {
    var r4 = sendViaNotiReply(room, '[전송테스트' + tag + '] ④ 알림 RemoteInput');
    out.push('notiReply=' + (r4.ok ? 'OK' : 'NO(' + r4.error + ')'));
  } catch (e4) { out.push('notiReply=ERR ' + e4); }

  Log.i('kakao-bot[전송테스트' + tag + '] room="' + room + '" ' + out.join(' | '));
}

function probeSend(room, reply) {
  probeSendOnce(room, reply, '');

  // 지연 재시도는 별도 스레드로 돌린다. 여기서 sleep 하면 그동안 들어오는 메시지 수집이 멈춘다.
  try {
    var t = new java.lang.Thread(new java.lang.Runnable({
      run: function () {
        try { java.lang.Thread.sleep(PROBE_DELAY_MS); } catch (eS) {}
        try { probeSendOnce(room, reply, '+60초'); } catch (eR) { Log.e('kakao-bot[전송테스트] 지연 예외: ' + eR); }
      }
    }));
    t.setDaemon(true);
    t.start();
  } catch (e) {
    Log.e('kakao-bot[전송테스트] 지연 스레드 생성 실패 — ' + e);
  }
}

// ── 대시보드 발신 ─────────────────────────────────────────────
//
// 방향이 반대인 경로다. 대시보드에서 쓴 글을 서버가 큐에 적어두면, 이 봇이 가져가 방에 넣는다.
// 서버는 카톡에 직접 말할 수 없다 — 알림에 실린 RemoteInput 세션을 가진 것은 이 단말뿐이다.
//
// ★ 여기서도 규칙 밖 방에는 아무것도 하지 않는다. 서버가 주는 방 이름이 규칙에 없으면 버린다.
//   서버가 실수로(또는 토큰이 새서) 엉뚱한 방 이름을 내려보내도 개인 카톡방에 글이 써지지 않는다.
//
// ★ 같은 건이 두 번 나가지 않는 근거는 서버의 claim 이다. 내려준 순간 sending 으로 잠긴다.
//   그래서 보낸 직후 결과를 바로 알려준다 — 늦게 알릴수록 "보냈는데 못 알린" 창이 커지고,
//   그 창에서 폰이 죽으면 서버가 되살려 같은 말이 두 번 나간다.
var _outboxGen = '';
var OUTBOX_GEN_PROP = 'sq.kakao.outbox.gen';
var _pendingJobs = [];   // 인입 응답에 얹혀 온 것 — 다음 주기에 루프가 집어간다
var _lastSendAt = 0;

/**
 * 연속 실패 시 폴링 간격을 늘린다.
 *
 * 서버가 오래 죽어 있을 때 15초마다 두드리는 것은 배터리·데이터·서버 몫을 다 태운다.
 * 실측(2026-08-12): Vercel 프로젝트가 중단돼 402 가 돌아오는 동안 계속 두드렸다.
 * 실패가 쌓이면 간격을 두 배씩 늘리고 10분에서 멈춘다 — 서버가 살아나면 한 번 성공으로
 * 곧바로 원래 주기로 돌아온다. 아예 멈추지 않는 이유는 사람이 다시 켜줘야 하는 상태를
 * 만들지 않기 위해서다.
 */
var OUTBOX_MAX_BACKOFF_MS = 10 * 60 * 1000;
var _outboxFailStreak = 0;
var _outboxLastCode = 0;

function _outboxNoteFailure(code) {
  _outboxFailStreak++;
  // 같은 코드가 반복되면 로그를 도배하지 않는다. 처음과 10회마다만 남긴다.
  if (code !== _outboxLastCode || _outboxFailStreak % 10 === 1) {
    var why = '';
    if (code === 402) why = ' — 배포가 중단된 상태다(Vercel 결제·사용량 한도). 서버를 다시 켜야 한다';
    else if (code === 401) why = ' — 토큰이 서버 KAKAO_INGEST_TOKEN 과 다르다';
    else if (code === 503) why = ' — 서버가 워크스페이스를 정하지 못했다(KAKAO_WORKSPACE_ID)';
    else if (code === 0) why = ' — 서버에 닿지 못했다(네트워크·도메인)';
    Log.e('kakao-bot[발신] 조회 실패 code=' + code + why
      + ' · 연속 ' + _outboxFailStreak + '회, 다음 시도 ' + Math.round(outboxDelayMs() / 1000) + '초 뒤');
  }
  _outboxLastCode = code;
}

/** 다음 폴링까지 기다릴 시간. 실패가 쌓일수록 두 배씩, 10분에서 멈춘다. */
function outboxDelayMs() {
  var delay = OUTBOX_POLL_MS;
  for (var i = 0; i < _outboxFailStreak && delay < OUTBOX_MAX_BACKOFF_MS; i++) delay *= 2;
  return (delay > OUTBOX_MAX_BACKOFF_MS) ? OUTBOX_MAX_BACKOFF_MS : delay;
}

/** 인입 응답 본문에서 얹혀 온 발신 건을 꺼낸다. 거래처가 방금 말한 방이라 세션이 가장 확실하다. */
function takeOutboxFrom(body) {
  if (!OUTBOX_ENABLED || !body || body.indexOf('"outbox"') < 0) return;
  try {
    var obj = JSON.parse(body);
    if (obj && obj.outbox && obj.outbox.length) {
      for (var i = 0; i < obj.outbox.length; i++) _pendingJobs.push(obj.outbox[i]);
      Log.i('kakao-bot[발신] 인입 응답에 ' + obj.outbox.length + '건 실려옴');
    }
  } catch (e) {
    Log.e('kakao-bot[발신] 인입 응답 파싱 실패 — ' + e);
  }
}

/**
 * 결과 보고 + 새 작업 수령을 한 번의 왕복으로 한다.
 * 실패하면 null 을 돌린다 — 이때 이미 보낸 것의 결과가 유실되지만, 서버가 리스 만료로
 * 되살려 다시 내려주므로 최악의 경우 같은 말이 한 번 더 나간다. 그래서 보고를 미루지 않는다.
 */
function outboxPost(acks) {
  var conn = null;
  try {
    var url = new java.net.URL(OUTBOX_ENDPOINT);
    conn = url.openConnection();
    conn.setRequestMethod('POST');
    conn.setConnectTimeout(SEND_TIMEOUT_MS);
    conn.setReadTimeout(SEND_TIMEOUT_MS);
    conn.setDoOutput(true);
    conn.setRequestProperty('Content-Type', 'application/json; charset=utf-8');
    conn.setRequestProperty('X-Ingest-Token', TOKEN);

    var payload = JSON.stringify({ acks: acks || [] });
    var os = conn.getOutputStream();
    os.write(new java.lang.String(payload).getBytes('UTF-8'));
    os.flush();
    os.close();

    var code = conn.getResponseCode();
    if (code !== 200) {
      _outboxNoteFailure(code);
      return null;
    }
    _outboxFailStreak = 0;
    var reader = new java.io.BufferedReader(
      new java.io.InputStreamReader(conn.getInputStream(), 'UTF-8'));
    var body = '';
    var line;
    while ((line = reader.readLine()) !== null) body += line;
    reader.close();

    var obj = JSON.parse(body);
    return (obj && obj.outbox) ? obj.outbox : [];
  } catch (e) {
    _outboxNoteFailure(0);
    Log.e('kakao-bot[발신] 조회 예외: ' + e);
    return null;
  } finally {
    if (conn !== null) { try { conn.disconnect(); } catch (e2) {} }
  }
}

// ── 방으로 나가는 통로 확보 ───────────────────────────────────
//
// 서버가 주는 방 이름은 우리가 교정한 이름(진짜 방 제목)이다. 그런데 메신저봇R 은 이 단말에서
// 방을 발신자명으로 알고 있어, Api.replyRoom(교정된 이름) 은 아는 방이 없다며 실패한다.
// 그래서 통로를 두 가지로 직접 들고 있는다.
//   1) replier   — 그 방에서 마지막으로 받은 메시지의 답장 객체(메신저봇R 이 준 것)
//   2) RemoteInput — 카톡 알림에 실린 "답장" 액션. API2 도 replier 도 없을 때의 마지막 수단
// 둘 다 카톡 알림 세션을 물고 있어 방이 오래 조용하면 만료된다. 만료는 발신 실패로 보고되고
// 대시보드에 failed 로 뜬다 — 조용히 사라지는 것보다 낫다.
var REPLY_TTL_MS = 30 * 60 * 1000;
var _replierByRoom = {};   // 교정된 방 제목 → { fn, raw, at }
var _notiReplyByRoom = {}; // 교정된 방 제목 → { action, inputs, at }

/** response·API2 콜백이 준 답장 객체를 그 방 이름으로 걸어둔다. raw 는 메신저봇R 이 아는 방 이름. */
function rememberReplier(room, rawRoom, replyFn) {
  if (!room || !replyFn) return;
  _replierByRoom[normRoom(room)] = { fn: replyFn, raw: rawRoom || '', at: _now() };
}

/** 카톡 알림의 "답장"(RemoteInput) 액션을 그 방 이름으로 걸어둔다. */
function captureReplyAction(sbn, room) {
  if (!room) return;
  try {
    var acts = sbn.getNotification().actions;
    if (!acts || !acts.length) return;
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      var ris = null;
      try { ris = a.getRemoteInputs(); } catch (e) {}
      if (!ris || !ris.length) continue;
      _notiReplyByRoom[normRoom(room)] = { action: a, inputs: ris, at: _now() };
      return;
    }
  } catch (e2) {
    Log.e('kakao-bot[발신] 알림 답장 액션 확보 실패: ' + e2);
  }
}

/**
 * 알림에 실린 RemoteInput 으로 직접 답장한다.
 * NotificationListenerService 는 다른 앱 알림의 PendingIntent 를 실행할 수 있다 —
 * 카톡 알림창에서 사람이 답장을 치는 것과 같은 경로다.
 */
function sendViaNotiReply(room, text) {
  var rec = _notiReplyByRoom[normRoom(room)];
  if (!rec) return { ok: false, error: '알림 답장 통로 없음(그 방 알림을 아직 못 받았다)' };
  if ((_now() - rec.at) > REPLY_TTL_MS) return { ok: false, error: '알림 답장 통로 만료' };

  var ctx = appContext();
  if (ctx === null) return { ok: false, error: 'Context 없음' };

  try {
    var intent = new android.content.Intent();
    var bundle = new android.os.Bundle();
    for (var i = 0; i < rec.inputs.length; i++) {
      bundle.putCharSequence(rec.inputs[i].getResultKey(), text);
    }
    android.app.RemoteInput.addResultsToIntent(rec.inputs, intent, bundle);
    rec.action.actionIntent.send(ctx, 0, intent);
    return { ok: true, via: 'noti.remoteInput' };
  } catch (e) {
    return { ok: false, error: 'RemoteInput 전송 실패 ' + e };
  }
}

/**
 * 방에 실제로 글을 넣는다. 통로를 순서대로 시도하고, 전부 실패하면 이유를 모아 보고한다.
 *
 * 반환값 판정이 애매한 점에 주의: 메신저봇R 버전에 따라 이 API 들이 boolean 을 주기도 하고
 * 아무것도 안 주기도 한다. 그래서 "명시적으로 false 일 때만 실패" 로 본다 — undefined 를
 * 실패로 치면 잘 나간 메시지를 3번 더 보내게 된다(같은 말이 방에 네 번 뜬다).
 */
function sendToRoom(room, text) {
  if (!isAllowedRoom(room)) {
    return { ok: false, error: '규칙에 없는 방 — 단말에서 거부' };
  }

  var errs = [];

  if (_bot && _bot.send) {
    try {
      var r1 = _bot.send(room, text);
      if (r1 !== false) return { ok: true, via: 'bot.send' };
      errs.push('bot.send=false');
    } catch (e1) { errs.push('bot.send 예외 ' + e1); }
  }

  var rp = _replierByRoom[normRoom(room)];
  if (rp && (_now() - rp.at) <= REPLY_TTL_MS) {
    try {
      var r2 = rp.fn(text);
      if (r2 !== false) return { ok: true, via: 'replier' };
      errs.push('replier=false');
    } catch (e2) { errs.push('replier 예외 ' + e2); }
  }

  var viaNoti = sendViaNotiReply(room, text);
  if (viaNoti.ok) return viaNoti;
  errs.push(viaNoti.error);

  if (typeof Api !== 'undefined' && Api.replyRoom) {
    // 메신저봇R 이 아는 이름으로 먼저 시도한다. 이 단말에서 그 이름은 방 제목이 아니라
    // 발신자명이라, 교정된 이름으로 부르면 "그런 방 없음" 으로 실패한다.
    var names = [];
    if (rp && rp.raw && normRoom(rp.raw) !== normRoom(room)) names.push(rp.raw);
    names.push(room);
    for (var i = 0; i < names.length; i++) {
      try {
        var r3 = Api.replyRoom(names[i], text);
        if (r3 !== false) return { ok: true, via: 'Api.replyRoom("' + names[i] + '")' };
        errs.push('Api.replyRoom("' + names[i] + '")=false');
      } catch (e3) { errs.push('Api.replyRoom 예외 ' + e3); }
    }
  }

  return { ok: false, error: errs.length ? errs.join(' / ') : '전송 API 없음' };
}

/** 연속 발신 사이 간격을 벌린다. 사람이 치는 속도를 벗어나면 자동화로 탐지된다. */
function sendGap() {
  var wait = SEND_MIN_GAP_MS - (_now() - _lastSendAt);
  var jitter = Math.floor(Math.random() * SEND_JITTER_MS);
  if (wait < 0) wait = 0;
  try { java.lang.Thread.sleep(wait + jitter); } catch (e) {}
  _lastSendAt = _now();
}

/** 밀린 것이 없어질 때까지 보내고 그때마다 결과를 보고한다. */
function outboxDrain() {
  if (!OUTBOX_ENABLED) return;

  var jobs = _pendingJobs;
  _pendingJobs = [];

  for (var round = 0; round < 5; round++) {
    var acks = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (!job || !job.id || !job.room || !job.text) continue;
      sendGap();
      var res = sendToRoom(String(job.room), String(job.text));
      if (res.ok) {
        Log.i('kakao-bot[발신] 전송 room="' + job.room + '" via=' + res.via);
        acks.push({ id: String(job.id), ok: true });
      } else {
        Log.e('kakao-bot[발신] 실패 room="' + job.room + '" — ' + res.error);
        acks.push({ id: String(job.id), ok: false, error: String(res.error) });
      }
    }

    // 보고와 다음 작업 수령이 같은 왕복이다. 보낼 게 없으면 acks 만 비우고 끝난다.
    var next = outboxPost(acks);
    if (next === null || next.length === 0) return;
    jobs = next;
  }
}

/**
 * 발신 루프를 세운다. 지금 살아 있는 옛 루프는 세대가 바뀌어 스스로 빠진다.
 *
 * ⚠️ 봇을 "끄기" 해도 이 자바 스레드는 죽지 않는다. 메신저봇R 은 스크립트 스코프만
 * 버리고, 이미 떠 있는 데몬 스레드는 그대로 돈다. 아래 onStartCompile 훅이 불리는
 * 단말에서는 그 훅이 세대를 바꿔 루프를 끊는다. 훅이 없는 단말에서 확실히 멈추려면
 * **메신저봇R 앱을 강제 종료**해야 한다(설정 → 앱 → 메신저봇R → 강제 중지).
 * 실측 2026-08-12: 봇을 끈 뒤에도 402 가 계속 찍혔다.
 */
function stopOutboxLoops() {
  try {
    java.lang.System.setProperty(OUTBOX_GEN_PROP, 'stopped-' + _now());
    Log.i('kakao-bot[발신] 폴링 중단 요청');
  } catch (e) {}
}

// 메신저봇R 이 스크립트를 다시 컴파일하거나 내릴 때 부르는 전역 훅. 지원하지 않는
// 버전에서는 그냥 안 불린다(무해). 불리면 옛 루프가 즉시 끊긴다.
function onStartCompile() {
  stopOutboxLoops();
}

/**
 * 발신 폴링 루프.
 *
 * 스크립트를 다시 컴파일하면 새 스코프가 만들어지고 옛 루프는 그대로 살아 있다. 그대로 두면
 * 컴파일할 때마다 루프가 하나씩 늘어 같은 메시지를 여러 번 집어가려 한다. 그래서 세대(gen)를
 * 시스템 프로퍼티에 박아두고, 값이 바뀐 루프는 스스로 빠진다.
 */
function startOutboxLoop() {
  if (!OUTBOX_ENABLED) {
    Log.i('kakao-bot[발신] 꺼짐 — 읽기 전용으로 동작');
    return;
  }

  _outboxGen = String(_now()) + '-' + String(Math.floor(Math.random() * 1000000));
  try { java.lang.System.setProperty(OUTBOX_GEN_PROP, _outboxGen); } catch (e) {}

  var myGen = _outboxGen;
  try {
    var t = new java.lang.Thread(new java.lang.Runnable({
      run: function () {
        while (true) {
          try { java.lang.Thread.sleep(outboxDelayMs()); } catch (eS) { return; }
          var cur = '';
          try { cur = String(java.lang.System.getProperty(OUTBOX_GEN_PROP)); } catch (eP) {}
          if (cur !== myGen) {
            Log.i('kakao-bot[발신] 이전 세대 루프 종료');
            return;
          }
          try { outboxDrain(); } catch (eD) { Log.e('kakao-bot[발신] 루프 예외: ' + eD); }
        }
      }
    }));
    t.setDaemon(true);
    t.start();
    Log.i('kakao-bot[발신] 폴링 시작 — ' + (OUTBOX_POLL_MS / 1000) + '초 주기');
  } catch (e) {
    // 루프가 안 서도 인입 응답에 얹혀 오는 건은 그대로 나간다(거래처가 말을 건 직후에만).
    Log.e('kakao-bot[발신] 폴링 스레드 생성 실패 — ' + e);
  }
}

// ── 전송 ──────────────────────────────────────────────────────
//
// ts 를 반드시 실어 보낸다. 없으면 서버가 수신 시각을 쓰는데, 재시도로 몇 분 뒤에 도착하면
// 그 시각으로 기록돼 순서가 뒤집힌다. 더 나쁜 건 멱등 키다 — 서버 해시가
// md5(분단위시각|발화자|본문) 라 분이 달라지면 해시도 달라지고, 첫 전송이 실제로는 성공했는데
// 응답만 못 받은 경우 같은 메시지가 두 번 저장된다.
function buildPayloadObj(room, sender, text, imageB64, chatId, logId, ts) {
  var obj = { room: room, sender: sender, text: text, ts: ts || nowIso() };
  if (chatId) obj.chatId = String(chatId);
  if (logId) obj.logId = String(logId);
  if (imageB64) {
    obj.image = imageB64;
    obj.imageName = 'kakao-' + _now() + '.jpg';
  }
  return obj;
}

function postPayload(obj) {
  var payload = JSON.stringify(obj);

  // 순수 Java HttpURLConnection 사용(메신저봇R 에서 Jsoup 보다 안정적).
  var conn = null;
  try {
    var url = new java.net.URL(ENDPOINT);
    conn = url.openConnection();
    conn.setRequestMethod('POST');
    conn.setConnectTimeout(SEND_TIMEOUT_MS);
    conn.setReadTimeout(SEND_TIMEOUT_MS);
    conn.setDoOutput(true);
    conn.setRequestProperty('Content-Type', 'application/json; charset=utf-8');
    conn.setRequestProperty('X-Ingest-Token', TOKEN);

    var os = conn.getOutputStream();
    os.write(new java.lang.String(payload).getBytes('UTF-8'));
    os.flush();
    os.close();

    var code = conn.getResponseCode();
    var stream = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
    var body = '';
    if (stream !== null) {
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream, 'UTF-8'));
      var line;
      while ((line = reader.readLine()) !== null) body += line;
      reader.close();
    }
    Log.i('kakao-bot POST ' + code + ' ' + body);

    // 서버가 미매칭이라고 답하면 단말 규칙이 낡은 것이다. 즉시 갱신해 다음부터 안 보낸다.
    if (body && body.indexOf('"unmatched":true') >= 0) refreshRules(true);
    // 등록·해제 직후에도 즉시 갱신한다. 안 하면 등록해도 최대 10분간 수집이 시작되지 않고,
    // 해제해도 그동안 계속 올라간다.
    if (body && body.indexOf('"registered":true') >= 0) refreshRules(true);
    if (body && body.indexOf('"unregistered":true') >= 0) refreshRules(true);

    // 4xx 는 다시 보내도 같은 결과다(토큰 오타·본문 불량). 큐에 넣으면 영원히 재시도한다.
    // 5xx·429 는 서버 쪽 일시 문제라 재시도 대상이다.
    //
    // 402 만은 4xx 인데도 재시도한다. 배포가 결제·사용량 한도로 중단됐다는 뜻이라 본문에는
    // 아무 잘못이 없고, 사람이 다시 켜면 그대로 통과한다. 여기서 버리면 서버가 꺼져 있던
    // 동안의 거래처 대화가 통째로 사라진다(실측 2026-08-12).
    if (code >= 200 && code < 300) {
      // 이 방으로 나갈 것이 응답에 실려 왔으면 받아둔다. 여기서 바로 보내지 않는 이유는
      // 발신 간격(4초+)만큼 수집이 멈추기 때문이다. 발신 루프가 집어간다.
      takeOutboxFrom(body);
      return { ok: true, body: body };
    }
    if (code >= 400 && code < 500 && code !== 429 && code !== 402) {
      Log.e('kakao-bot POST 영구실패 code=' + code + ' — 재시도하지 않음');
      return { ok: false, retry: false, body: body };
    }
    if (code === 402) {
      Log.e('kakao-bot POST 402 — 배포가 중단돼 있다(Vercel 결제·사용량 한도). 큐에 넣고 기다린다');
    }
    return { ok: false, retry: true, body: body };
  } catch (e) {
    // 네트워크 끊김·타임아웃. 재시도 대상이다.
    Log.e('kakao-bot POST 예외: ' + e);
    return { ok: false, retry: true, body: null };
  } finally {
    if (conn !== null) { try { conn.disconnect(); } catch (e2) {} }
  }
}

// ── 수집 본체 (구·신 API 공통) ────────────────────────────────
//
// tsOverride: 메시지 자신의 시각(알림에서 꺼낸 것). 없으면 지금 시각을 쓴다.
function handleMessage(room, msg, sender, isGroupChat, imageB64, chatId, logId, reply, tsOverride) {
  if (HANDLE_GROUP_ONLY && !isGroupChat) return;

  // 메시지가 도착한 시각을 여기서 못 박는다. 큐에 들어가 나중에 보내도 이 값이 따라간다.
  var ts = tsOverride || nowIso();

  var text = trimText(msg);
  var hasText = text.length > 0;
  if (!hasText && !imageB64) return; // 입장·퇴장 같은 시스템 메시지

  // 알림 훅과 response 콜백이 같은 메시지를 각각 들고 온다. 먼저 온 쪽이 처리한다.
  if (!_claimMessage(sender, text)) return;

  // 새 메시지를 보내기 전에 밀린 것을 먼저 비운다. 순서를 지키기 위한 것이기도 하고,
  // 타이머 없이 재시도를 굴리는 유일한 방법이기도 하다(메신저봇R 에서 타이머 스레드는
  // 스크립트를 다시 컴파일할 때 죽는다).
  flushQueue();

  refreshRules(false);

  // 선필터가 켜져 있을 때만 규칙이 필수다. 규칙을 못 받았는데 필터로 거르겠다는 건
  // "무엇을 거를지 모르는 채로 거른다" 는 뜻이라, 그때는 아무것도 안 보낸다(fail-closed).
  if (DEVICE_FILTER && !_rulesEverLoaded) {
    Log.e('kakao-bot: 규칙 미수신 — 전송 보류 room="' + room + '"');
    return;
  }

  // 규칙 밖 방이어도 등록 명령 한 종류만은 올려보낸다. 그러지 않으면 아직 등록되지 않은
  // 방에서 "#등록" 을 쳐도 단말이 먼저 버려 영원히 등록할 수 없다.
  var cmd = isRoomCommand(text);

  // 방 이름 자리에 발신자명이 있는 상태로 올려봐야 서버가 rejected:no-room-title 로 돌려보낸다
  // (그 이름으로 규칙을 만들면 그 사람이 말하는 모든 방이 한 거래처로 붙기 때문이다).
  // 구 API 콜백은 이 단말에서 늘 room=발신자명 이라, 안 보내는 편이 로그가 깨끗하다.
  // 같은 메시지를 알림 훅이 제대로 된 방 이름으로 이미 올린다.
  if (cmd && normRoom(room) === normRoom(sender)) {
    Log.i('kakao-bot: 방 이름 = 발신자명 — 등록 명령 보류(알림 훅이 처리한다)');
    return;
  }

  var known = isAllowedRoom(room);
  if (DEVICE_FILTER && !known && !cmd) {
    // 규칙에 없는 방 = 개인 카톡. 로그에도 방 이름만 남기고 본문은 남기지 않는다.
    Log.i('kakao-bot: 규칙 밖 방 스킵 room="' + room + '"');
    return;
  }

  // 전송 확인은 단말에서 끝난다 — 서버로 올리지 않고 저장도 하지 않는다(임시 진단).
  if (text === PROBE_CMD) {
    probeSend(room, reply);
    return;
  }

  // 명령은 사진을 함께 올리지 않는다 — 서버가 저장하지 않고 버리므로 보낼 이유가 없다.
  // 규칙 밖 방의 사진도 마찬가지다(서버가 업로드 전에 매칭을 먼저 본다).
  var photo = (cmd || (PHOTO_ONLY_FROM_KNOWN_ROOMS && !known)) ? null : imageB64;
  var obj = buildPayloadObj(room, sender, text, photo, chatId, logId, ts);
  var res = postPayload(obj);
  if (!res.ok && res.retry) enqueue(obj);
}

// ── 알림에서 진짜 방 제목 확보 ────────────────────────────────
// 카톡 알림(MessagingStyle)은 단톡방에서 title·conversationTitle 에 **방 제목**을 넣고,
// 발신자는 android.messages 안에만 넣는다(1:1 은 title 이 곧 상대 이름 = 방 이름).
// 메신저봇R 이 이 구조를 못 풀고 발신자명을 room 으로 넘기는 단말이 있어, 그 경우 단톡방인데도
// 말한 사람마다 room 이 달라진다. 그 상태로는 규칙이 걸릴 수 없어 알림 원본에서 복원한다.
var _notiBySender = {};
var _notiLast = null;
var _notiOk = false;
var NOTI_TTL_MS = 15000;
// 알림 속 메시지 시각이 이보다 오래됐으면 재게시로 본다(카톡은 같은 알림을 다시 올린다).
var NOTI_STALE_MS = 120000;

/**
 * 알림 1건을 기억한다. 발신자 → 방 제목·본문·사진.
 *
 * ⚠️ 어떤 필드도 직전 기록에서 물려받지 않는다. 실측(2026-08-11)에서 물려받기가
 * 개인 카톡 유출을 만들었다:
 *   1) 신동규가 [테스트상자] 발주 방에서 말함 → _notiBySender["신동규"].room = 그 방
 *   2) 같은 사람과의 1:1 개인 카톡 → 그 알림의 room 이 빈 값이라고 잘못 판정
 *   3) 빈 값이면 이전 방을 물려받도록 되어 있어 → 개인 대화가 거래처 방으로 전송됨
 *
 * 2단계가 애초에 틀렸다. 1:1 방에도 이름이 있다 — 상대 이름이 곧 방 이름이다.
 * 그것을 제대로 채워 넣으면 "빈 칸" 자체가 생기지 않고, 물려받기가 필요 없어진다
 * (notiRoomOf 참고). 그래서 여기서는 물려받지 않는다.
 */
function _rememberNoti(sender, room, text, imageB64) {
  var rec = {
    room: room || '',
    text: (text !== null && text !== undefined) ? String(text) : '',
    image: imageB64 || null,
    at: _now(),
  };
  if (sender) _notiBySender[String(sender)] = rec;
  _notiLast = rec;
}

/**
 * 이 메시지를 지금 내가 처리한다고 선점한다. 이미 다른 경로가 가져갔으면 false.
 *
 * 알림 훅과 response 콜백이 같은 메시지를 각각 들고 온다. 순서가 보장되지 않아 어느 쪽이
 * 먼저일지 모르므로, "먼저 온 쪽이 처리한다" 로 정리한다. 서버 멱등키가 한 번 더 막지만
 * 그건 최후의 그물이고, 여기서 잡으면 왕복이 절반으로 준다.
 *
 * 창을 20초로 잡은 이유: 두 경로의 시차는 밀리초 단위라 넉넉하고, 사람이 같은 말을
 * 정말로 두 번 하는 간격(같은 분 안)은 서버 해시가 어차피 하나로 합친다.
 */
var CLAIM_TTL_MS = 20000;
var _claims = {};
var _claimSweptAt = 0;

function _claimMessage(sender, text) {
  var now = _now();
  // ★ 열쇠에 방 이름을 넣지 않는다. 두 경로가 같은 메시지에 **서로 다른 방 이름**을 붙여
  //   오기 때문이다(알림 훅은 "방#12345", 구 API 는 발신자명). 방을 넣으면 열쇠가 갈라져
  //   둘 다 통과하고, 같은 말이 서로 다른 두 방에 각각 쌓인다.
  var key = normRoom(sender) + '|' + trimText(text).slice(0, 80);

  // 맵이 무한정 자라지 않게 가끔 쓸어낸다. 타이머를 쓸 수 없는 환경이라 호출 시점에 한다.
  if (now - _claimSweptAt > CLAIM_TTL_MS) {
    _claimSweptAt = now;
    var fresh = {};
    for (var k in _claims) {
      if (_claims.hasOwnProperty(k) && (now - _claims[k]) < CLAIM_TTL_MS) fresh[k] = _claims[k];
    }
    _claims = fresh;
  }

  if (_claims[key] && (now - _claims[key]) < CLAIM_TTL_MS) return false;
  _claims[key] = now;
  return true;
}

/**
 * 이 알림 기록이 지금 처리 중인 메시지의 것인지 본문으로 대조한다.
 *
 * 알림 훅과 메시지 콜백은 서로 독립된 이벤트라 순서가 보장되지 않는다. 순서가 뒤집히면
 * 같은 사람의 "직전 알림" 이 다른 방(개인 카톡) 것일 수 있고, 그대로 믿으면 개인 대화가
 * 거래처 방으로 들어간다. 본문이 맞지 않으면 방 제목을 포기한다 — 포기하면 규칙에
 * 걸리지 않아 전송되지 않는다(fail-closed).
 *
 * 알림 본문은 길면 잘리므로 완전일치를 요구하지 않고 앞부분 대조로 본다.
 */
function _notiTextMatches(recText, msgText) {
  var a = trimText(recText);
  var b = trimText(msgText);
  if (!a || !b) return false;
  if (a === b) return true;
  var head = (a.length < b.length ? a : b).slice(0, 20);
  if (head.length < 4) return false;
  return a.indexOf(head) >= 0 && b.indexOf(head) >= 0;
}

/**
 * 이 알림 기록으로 방 제목을 인정할 수 있는가.
 *
 * 본문이 있으면 대조한다 — 알림 훅과 메시지 콜백은 순서가 보장되지 않아, 대조 없이 믿으면
 * 같은 사람의 직전 알림(개인 카톡)이 거래처 방으로 둔갑한다.
 *
 * 본문이 아예 없으면 대조할 방법이 없다. 이때 "불일치" 로 처리하면 방 제목이 멀쩡히
 * 실려 있어도 영원히 못 쓴다(실측 2026-08-12: 알림 내용 숨김·요약 알림에서 본문이 빈다).
 * 그래서 본문이 없는 알림은 방 제목만 보고 한 번 인정하되, 쓰는 즉시 소모한다 —
 * 한 알림이 두 메시지의 방을 대신하지 못하게 한다.
 */
function _notiRoomUsable(rec, msgText) {
  if (!rec || !rec.room) return false;
  if ((_now() - rec.at) >= NOTI_TTL_MS) return false;
  if (trimText(rec.text)) return _notiTextMatches(rec.text, msgText);
  return true;
}

function _lookupNotiRoom(sender, msgText) {
  if (sender) {
    var r = _notiBySender[String(sender)];
    if (_notiRoomUsable(r, msgText)) {
      var room = r.room;
      // 본문 없이 인정한 건은 한 번만 쓴다 — 한 알림이 뒤따르는 메시지의 방까지 대신하면
      // 그게 곧 물려받기이고, 물려받기가 개인 카톡 유출을 만든다.
      if (!trimText(r.text)) r.room = '';
      return room;
    }
  }
  // 직전 알림이 아주 최근(1.5초 이내)이면 그 방으로 본다.
  if (_notiLast && _notiLast.room && (_now() - _notiLast.at) < 1500
      && _notiRoomUsable(_notiLast, msgText)) {
    var last = _notiLast.room;
    if (!trimText(_notiLast.text)) _notiLast.room = '';
    return last;
  }
  return null;
}

/** 발신자의 최근 알림 본문 전문(bigText). 긴 메시지 잘림 복원용. */
function _lookupNotiText(sender) {
  var now = _now();
  if (sender) {
    var r = _notiBySender[String(sender)];
    if (r && r.text && (now - r.at) < NOTI_TTL_MS) return r.text;
  }
  if (_notiLast && _notiLast.text && (now - _notiLast.at) < 1500) return _notiLast.text;
  return '';
}

/**
 * 발신자의 최근 알림에서 꺼낸 사진. 메신저봇R 이 이미지를 안 줄 때의 유일한 경로다.
 * 사진은 한 번만 쓴다 — 꺼내면 지운다. 안 지우면 뒤따르는 텍스트 메시지에 같은 사진이 또 붙는다.
 */
function _takeNotiImage(sender) {
  var now = _now();
  var rec = sender ? _notiBySender[String(sender)] : null;
  if (rec && rec.image && (now - rec.at) < NOTI_TTL_MS) {
    var b64 = rec.image;
    rec.image = null;
    return b64;
  }
  if (_notiLast && _notiLast.image && (now - _notiLast.at) < 1500) {
    var last = _notiLast.image;
    _notiLast.image = null;
    return last;
  }
  return null;
}

// ── 알림 파싱 (API2·구 API 공통) ──────────────────────────────
// 여기서 알림 원본을 직접 읽어 방 제목·발신자·본문을 뽑는다. 메신저봇R 이 넘겨주는 room 보다
// 이쪽이 정확하고, NOTI_INGEST 가 켜져 있으면 여기서 곧바로 수집까지 한다.
// API2 는 Event.NOTIFICATION_POSTED 로, 구 API 는 전역 onNotificationPosted 로 들어온다.
var _api2 = false;      // 리스너 등록 성공 여부
var _api2Fired = false; // API2 로 메시지를 실제로 1건이라도 받았는지
var _api2Why = '';      // API2 가 안 켜진 이유(진단용)
var _notiSeen = false;  // 알림 훅이 한 번이라도 불렸는지 — 복원 실패 원인 구분용
var _notiKeysLogged = false; // extras 키 덤프는 한 번이면 된다
var _bot = null;

// ── 알림에서 사진 꺼내기 ──────────────────────────────────────
// 메신저봇R 은 알림 파싱 기반이라 사진 바이트를 스크립트에 넘겨주지 않는다(실측: chat.image·
// imageDB 전부 없음). 남은 경로는 알림 자체다.
//
//   android.picture   BigPictureStyle 의 미리보기 비트맵. 원본보다 작다
//   android.messages  MessagingStyle 각 메시지의 content:// URI. 원본 화질
//
// URI 경로가 되는 이유: NotificationListenerService 는 알림에 실린 URI 에 대해 일시적
// 읽기 권한을 받는다. 그래서 다른 앱(카톡)의 사진을 열 수 있다.
//
// 원본이 3MB 를 넘으면 base64 가 4MB 가 되어 Vercel 함수 본문 상한에 걸린다.
// 긴 변 1600px·JPEG 80 으로 줄여 상한 아래로 묶는다. 발주서·견적서 사진을 읽는 용도라
// 이 정도면 글자가 남는다.
var IMAGE_MAX_SIDE = 1600;
var IMAGE_MAX_BASE64 = 3 * 1024 * 1024;

function appContext() {
  try { if (typeof App !== 'undefined' && App.getContext) return App.getContext(); } catch (e) {}
  try { if (typeof Api !== 'undefined' && Api.getContext) return Api.getContext(); } catch (e2) {}
  return null;
}

function bitmapToJpegBase64(bmp) {
  try {
    var w = bmp.getWidth();
    var h = bmp.getHeight();
    var scaled = bmp;
    if (w > IMAGE_MAX_SIDE || h > IMAGE_MAX_SIDE) {
      var ratio = (w > h) ? (IMAGE_MAX_SIDE / w) : (IMAGE_MAX_SIDE / h);
      scaled = android.graphics.Bitmap.createScaledBitmap(
        bmp, Math.round(w * ratio), Math.round(h * ratio), true);
    }
    var bos = new java.io.ByteArrayOutputStream();
    scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, bos);
    var bytes = bos.toByteArray();
    bos.close();
    var b64 = String(android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
    if (b64.length > IMAGE_MAX_BASE64) {
      Log.e('kakao-bot[NOTI] 사진이 상한 초과 — ' + b64.length + 'B, 전송 생략');
      return null;
    }
    return b64;
  } catch (e) {
    Log.e('kakao-bot[NOTI] 사진 인코딩 실패: ' + e);
    return null;
  }
}

/** MessagingStyle 메시지들의 content:// URI 에서 비트맵을 얻는다. 최신 것부터 본다. */
function bitmapFromNotiMessages(ex, tried) {
  var arr = null;
  try { arr = ex.get('android.messages'); } catch (e) { tried.push('messages=err'); return null; }
  if (arr === null || arr === undefined) { tried.push('messages=null'); return null; }

  var ctx = appContext();
  if (ctx === null) { tried.push('context=null'); return null; }

  var resolver = ctx.getContentResolver();
  for (var i = arr.length - 1; i >= 0; i--) {
    var stream = null;
    try {
      var bundle = arr[i];
      if (!bundle || !bundle.get) continue;
      var uri = bundle.get('uri');
      if (uri === null || uri === undefined) continue;
      var u = (typeof uri === 'string') ? android.net.Uri.parse(uri) : uri;
      stream = resolver.openInputStream(u);
      if (stream === null) continue;
      var bmp = android.graphics.BitmapFactory.decodeStream(stream);
      if (bmp !== null) {
        tried.push('messages[' + i + '].uri=ok');
        return bmp;
      }
    } catch (e2) {
      tried.push('messages[' + i + ']=err');
    } finally {
      if (stream !== null) { try { stream.close(); } catch (e3) {} }
    }
  }
  tried.push('messages=uri없음');
  return null;
}

function extractNotiImage(ex) {
  var tried = [];
  var bmp = null;

  try {
    var pic = ex.get('android.picture');
    if (pic !== null && pic !== undefined) {
      bmp = pic;
      tried.push('android.picture=ok');
    } else {
      tried.push('android.picture=null');
    }
  } catch (e) {
    tried.push('android.picture=err');
  }

  if (bmp === null) bmp = bitmapFromNotiMessages(ex, tried);

  var b64 = (bmp === null) ? null : bitmapToJpegBase64(bmp);
  Log.i('kakao-bot[NOTI] 사진 시도 [' + tried.join(' ') + '] → '
    + (b64 ? (b64.length + 'B') : '실패'));
  return b64;
}

/**
 * MessagingStyle 알림에서 마지막 메시지의 발신자명을 꺼낸다.
 *
 * ★ 여기가 오래 틀려 있던 자리다. 단톡방 알림은 android.title 에 **방 제목**을 넣고,
 *   발신자는 android.messages 안에만 넣는다. title 을 발신자로 쓰면 _notiBySender 가
 *   방 이름을 키로 잡아 구 API 쪽 조회(_lookupNotiRoom(sender))가 100% 빗나간다.
 *   방 제목이 알림에 멀쩡히 실려 와도 "방제목 복원 실패" 가 되고 #등록 부터 안 먹는다.
 */
function notiSenderOf(ex) {
  try {
    var arr = ex.get('android.messages');
    if (arr === null || arr === undefined) return '';
    for (var i = arr.length - 1; i >= 0; i--) {
      var b = arr[i];
      if (!b || !b.get) continue;
      var p = b.get('sender_person');  // API 28+ 은 Person 객체로 온다
      if (p !== null && p !== undefined) {
        try {
          var nm = p.getName();
          if (nm !== null && nm !== undefined && String(nm)) return String(nm);
        } catch (eP) {}
      }
      var s = b.get('sender');         // 구형은 CharSequence
      if (s !== null && s !== undefined && String(s)) return String(s);
    }
  } catch (e) {}
  return '';
}

/** MessagingStyle 마지막 메시지 본문. bigText 보다 정확하다(발신자명이 섞이지 않는다). */
function notiTextOf(ex) {
  try {
    var arr = ex.get('android.messages');
    if (arr === null || arr === undefined) return '';
    for (var i = arr.length - 1; i >= 0; i--) {
      var b = arr[i];
      if (!b || !b.get) continue;
      var t = b.get('text');
      if (t !== null && t !== undefined && String(t)) return String(t);
    }
  } catch (e) {}
  return '';
}

/**
 * MessagingStyle 마지막 메시지가 찍힌 시각(epoch ms). 없으면 0.
 *
 * 이 값이 중요한 이유: 카톡은 같은 알림을 여러 번 다시 올린다(읽음 처리·묶음 갱신 등).
 * 그때마다 지금 시각을 ts 로 붙이면 서버 멱등키 md5(분단위시각|발화자|본문) 의 분이 달라져
 * 같은 말이 두 번 저장된다. 메시지 자신의 시각을 쓰면 몇 번을 다시 받아도 같은 키가 된다.
 */
function notiTimeOf(ex) {
  try {
    var arr = ex.get('android.messages');
    if (arr === null || arr === undefined) return 0;
    for (var i = arr.length - 1; i >= 0; i--) {
      var b = arr[i];
      if (!b || !b.get) continue;
      var t = b.get('time');
      if (t === null || t === undefined) continue;
      var ms = parseFloat(String(t));  // java.lang.Long → 숫자
      if (ms > 0) return ms;
    }
  } catch (e) {}
  return 0;
}

/**
 * 단톡방인가. java.lang.Boolean 은 값이 false 여도 객체라 그냥 !! 하면 항상 true 다 —
 * 문자열로 비교해야 한다. 키가 없는 단말도 있어서 없으면 false 로 본다.
 */
function notiIsGroup(ex) {
  try {
    var v = ex.get('android.isGroupConversation');
    if (v !== null && v !== undefined) return String(v) === 'true';
  } catch (e) {}
  return false;
}

/** 카톡이 채팅방 알림들 위에 얹는 묶음(요약) 알림. 본문도 방 제목도 없어 처리하면 안 된다. */
function notiIsSummary(sbn) {
  try {
    var FLAG_GROUP_SUMMARY = 0x00000200;
    return (sbn.getNotification().flags & FLAG_GROUP_SUMMARY) !== 0;
  } catch (e) { return false; }
}

function exStr(ex, key) {
  try {
    var v = ex.get(key);
    if (v === null || v === undefined) return '';
    var s = String(v);
    return (s === 'null') ? '' : s;
  } catch (e) { return ''; }
}

/**
 * 방 제목이 실려 올 수 있는 자리. 앞에서부터 먼저 값이 있는 것을 쓴다.
 *
 * ★ 이 단말(실측 2026-08-12)의 카톡 알림은 화면에 (발신자 + 내용) 만 띄운다.
 *   android.title = 발신자명, android.conversationTitle = 빈 값, android.subText = 빈 값.
 *   단톡방이든 오픈채팅이든 1:1 이든 전부 그렇다.
 *   그런데 extras 키 덤프에 android.hiddenConversationTitle 이 있었다 — 카톡이 방 제목을
 *   화면에 안 띄우면서 그 자리에 숨겨 실어 보낸다(MessagingStyle 이 표시하지 않을 제목을
 *   보관하는 표준 자리다). 여기가 이 단말에서 방 제목을 얻는 유일한 통로다.
 *
 *   android.title 은 후보에 넣지 않는다. 이 단말에서 그 값은 100% 발신자명이다.
 */
var ROOM_TITLE_KEYS = [
  'android.conversationTitle',
  'android.hiddenConversationTitle',
  'android.subText',
  'android.summaryText',
  'android.infoText'
];

/**
 * 방 제목을 못 얻었을 때 알림 열쇠로 만드는 대체 방 이름.
 *
 * 이 접두어를 바꾸면 이미 `#등록` 해둔 방들의 규칙이 전부 안 걸리게 된다. 바꾸지 말 것.
 */
var ROOM_ID_PREFIX = '방#';

/**
 * 이 알림이 가리키는 방 이름.
 *
 * 1:1 방에서 title 을 방 이름으로 쓰는 것은 안전하다 — 상대 이름이 곧 그 방의 이름이고
 * (카톡 대화목록에 그렇게 뜬다), 무엇보다 "이 알림은 방 이름이 없다" 는 빈 칸이 사라져
 * 빈 칸을 직전 방으로 메우는 추측(=개인 카톡 유출)이 필요 없어진다.
 * 단톡방에서는 절대 title 로 폴백하지 않는다 — 그건 발신자명이다.
 */
function notiRoomOf(ex, isGroup, ntitle) {
  for (var i = 0; i < ROOM_TITLE_KEYS.length; i++) {
    var v = exStr(ex, ROOM_TITLE_KEYS[i]);
    if (v) return v;
  }
  if (!isGroup && ntitle) return ntitle;
  return '';
}

/**
 * 방을 가리키는 열쇠(key). 이름을 한 글자도 못 얻는 단말에서 방을 구분하는 유일한 수단이다.
 *
 * ★ 실측 2026-08-12: 이 단말의 카톡 알림은 방 제목을 어느 칸에도 안 싣는다.
 *   conversationTitle·hiddenConversationTitle·subText·summaryText·infoText 전부 빈 값,
 *   threadId 는 **0**(모든 방이 0 이라 쓸 수 없다), chatLogId 는 메시지마다 다른 값
 *   (3905537715021621000 = 메시지 ID, 방 ID 가 아니다).
 *
 *   남은 것은 알림 자신의 신원이다. 안드로이드 알림은 (패키지, tag, id) 로 식별되고,
 *   카톡은 **채팅방 하나당 알림 하나**를 올려 같은 방의 새 메시지로 그 알림을 갱신한다.
 *   즉 tag·id 가 곧 방 열쇠다. 이름이 아니라 이걸로 방을 가른다.
 *
 * 값이 없거나 0 이면 쓰지 않는다 — 0 을 그대로 쓰면 **모든 방이 한 방으로 합쳐진다**.
 */
function notiRoomKeyOf(sbn, ex) {
  var candidates = [];
  // 카톡이 스스로 실어 보내는 방 ID 가 있으면 그게 가장 정확하다.
  // (실측 2026-08-12: 이 단말은 threadId=0 이라 여기서 걸러진다.)
  candidates.push(exStr(ex, 'threadId'));
  candidates.push(exStr(ex, 'chatId'));
  // 없으면 알림 자신의 신원. 카톡은 방마다 다른 tag·id 로 알림을 올린다.
  try { candidates.push(String(sbn.getTag() || '')); } catch (e) {}
  try { candidates.push(String(sbn.getId())); } catch (e2) {}

  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    if (!v || v === '0' || v === 'null' || v === 'undefined') continue;
    return v;
  }

  // 최후의 수단 — 알림 키 전체. 형식은 "user|패키지|id|tag|uid" 다.
  //
  // 이게 **절대 실패하지 않는** 이유: 안드로이드는 같은 키로 올린 알림을 새 알림이 아니라
  // 기존 알림의 갱신으로 처리한다. 카톡이 채팅방 여러 개를 알림창에 동시에 띄운다는 것은
  // 그 방들의 키가 서로 다르다는 뜻이다. tag 가 null 이고 id 가 0 이어도, 그 조합 전체는
  // 방마다 다를 수밖에 없다. 안 그러면 방들이 서로의 알림을 덮어써서 하나만 남는다.
  //
  // 여기까지 왔는데 빈 값을 돌려주면 봇은 그 방을 영영 못 본다. 보기 흉해도 키를 만든다 —
  // 이름은 사람이 대시보드에서 붙이면 된다("연결 안 된 방" 목록).
  try {
    var k = String(sbn.getKey() || '');
    if (k) return k.replace(/\|/g, '-');
  } catch (e3) {}
  return '';
}

/**
 * 진단용 — 알림 신원 한 줄. 방마다 다른 값이 나오는지 이 줄로 확인한다.
 *
 * unread 를 같이 찍는 이유: 메신저 알림은 안 읽은 메시지가 1건일 때와 여러 건일 때
 * 형식이 달라지는 경우가 많다(1건이면 title=발신자, 여러 건이면 title=방 이름).
 * 2026-08-11 에는 방 제목이 나왔는데 08-12 에는 안 나온 차이를 이 값으로 가려낸다.
 */
function notiIdentityLog(sbn, ex) {
  var tag = '?', id = '?', gkey = '?';
  try { tag = String(sbn.getTag()); } catch (e) {}
  try { id = String(sbn.getId()); } catch (e2) {}
  try { gkey = String(sbn.getGroupKey()); } catch (e3) {}
  return 'tag=' + tag + ' id=' + id + ' group=' + gkey
    + ' unread=' + (exStr(ex, 'android.conversationUnreadMessageCount') || '?')
    + ' msgs=' + notiMessageCount(ex)
    + ' style=' + (exStr(ex, 'android.template') || exStr(ex, 'notificationStyle') || '?')
    + ' threadId=' + (exStr(ex, 'threadId') || '없음')
    + ' chatLogId=' + (exStr(ex, 'chatLogId') || '없음');
}

function notiMessageCount(ex) {
  try {
    var arr = ex.get('android.messages');
    if (arr === null || arr === undefined) return 0;
    return arr.length;
  } catch (e) { return '?'; }
}

function handleKakaoNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (ep) {}
    if (pkg.indexOf('kakao') < 0) return;
    if (notiIsSummary(sbn)) return;

    var ex = sbn.getNotification().extras;
    function gs(key) {
      try {
        var v = ex.get(key);
        if (v === null || v === undefined) return '';
        return String(v);
      } catch (e) { return ''; }
    }
    // ★ 이 단말에서 android.title 은 방 제목이 아니라 **발신자명**이다. 방 제목으로 쓰지 말 것.
    var ntitle = gs('android.title');
    var isGroup = notiIsGroup(ex) || !!gs('android.conversationTitle');

    var msgSender = notiSenderOf(ex);
    // messages 가 안 실린 알림(축약·갱신 알림)이 있다. 그때는 title 을 발신자로 본다 —
    // 이 단말의 알림은 (발신자 + 내용) 형식이라 title 이 곧 발신자다(실측 2026-08-12).
    // 예전에는 단톡방이면 빈 값으로 뒀는데, 그러면 발신자가 없다고 판단해 그 메시지를
    // 통째로 버렸다. 방을 찾아놓고도 못 올리는 구멍이었다.
    var sender = msgSender || ntitle;
    var notiBody = notiTextOf(ex) || gs('android.bigText') || gs('android.text');
    var msgAt = notiTimeOf(ex);
    var roomKey = notiRoomKeyOf(sbn, ex);

    var roomToSave = notiRoomOf(ex, isGroup, ntitle);
    // 방 제목 자리에서 발신자명이 나왔으면 그건 방 제목이 아니다. 추측하지 않는다.
    if (msgSender && normRoom(roomToSave) === normRoom(msgSender) && isGroup) roomToSave = '';
    // 이름은 못 얻었지만 방 구분은 되는 경우 — 이름을 지어 붙여 #등록 이라도 되게 한다.
    var roomFromKey = false;
    if (!roomToSave && roomKey) {
      roomToSave = ROOM_ID_PREFIX + roomKey;
      roomFromKey = true;
    }

    _notiSeen = true;

    // 알림마다 남긴다. 한 번만 찍던 때는 카톡이 같이 띄우는 빈 요약 알림이 첫 줄을 차지해
    // "알림에 아무것도 없다" 로 보였다(실측 2026-08-12). 본문은 길이만 남긴다 —
    // 개인 카톡 본문이 로그에 쌓이면 안 된다.
    if (NOTI_DEBUG) {
      Log.i('kakao-bot[NOTI] room="' + roomToSave + '"' + (roomFromKey ? '(열쇠)' : '')
        + ' sender="' + sender + '" group=' + isGroup
        + ' body=' + (notiBody ? String(notiBody).length + '자' : '없음'));

      // ★ 방마다 이 값이 다른지 확인하는 줄이다. 두 방에서 tag·id 가 같게 나오면
      //   그 열쇠로는 방을 못 가른다(모든 방이 한 방으로 합쳐진다).
      Log.i('kakao-bot[NOTI-KEY] ' + notiIdentityLog(sbn, ex));

      // 방 제목이 어느 칸에 실려오는지도 남긴다. 이 단말은 전부 빈 값이지만, 카톡 업데이트나
      // 다른 단말에서 값이 생기면 이름 기반으로 되돌아갈 수 있다.
      var cand = [];
      for (var ci = 0; ci < ROOM_TITLE_KEYS.length; ci++) {
        var ck = ROOM_TITLE_KEYS[ci];
        cand.push(ck.replace('android.', '') + '="' + exStr(ex, ck) + '"');
      }
      cand.push('title="' + ntitle + '"');
      Log.i('kakao-bot[NOTI-CAND] ' + cand.join(' '));

      // extras 에 어떤 키가 실려오는지 한 번만 덤프한다. 값이 아니라 키 이름만 남긴다.
      if (!_notiKeysLogged) {
        _notiKeysLogged = true;
        try {
          var ks = ex.keySet().toArray();
          var names = [];
          for (var ki = 0; ki < ks.length; ki++) names.push(String(ks[ki]));
          Log.i('kakao-bot[NOTI-KEYS] ' + names.join(' '));
        } catch (eK) { Log.e('kakao-bot[NOTI-KEYS] 덤프 실패: ' + eK); }
      }
    }

    if (!roomToSave) {
      // getKey() 까지 실패한 경우. 여기까지 오면 이 알림으로 할 수 있는 게 없다.
      Log.e('kakao-bot[NOTI] 방을 특정할 수 없다 — ' + notiIdentityLog(sbn, ex));
    }

    // 이 방으로 나갈 답장 통로를 잡아둔다. API2 가 없는 단말에서는 이것이 유일한 발신 경로다.
    captureReplyAction(sbn, roomToSave);

    // 사진은 "규칙에 걸리는 방" + "사진 알림" 일 때만 꺼낸다.
    //
    // 방을 먼저 확인하는 이유가 핵심이다 — 개인 카톡·가족방 사진까지 디코딩하면
    // 전송은 안 하더라도 개인 사진이 이 단말의 메모리를 거치게 된다. 그럴 이유가 없다.
    // 비트맵 디코딩·리사이즈가 무거운 작업이라는 점도 있다.
    var notiImage = null;
    if (roomToSave && looksLikePhoto(notiBody) && isAllowedRoom(roomToSave)) {
      notiImage = extractNotiImage(ex);
    }

    _rememberNoti(sender, roomToSave, notiBody, notiImage);

    // 안 올리기로 했으면 **왜** 안 올리는지를 남긴다. 여기서 조용히 빠져나가면
    // 대시보드는 "수집된 방 0" 인데 로그에는 아무 단서도 없다(2026-08-12 에 그랬다).
    if (NOTI_INGEST) {
      if (!roomToSave) {
        Log.e('kakao-bot[NOTI] 수집 생략 — 방을 특정 못 함. ' + notiIdentityLog(sbn, ex));
      } else if (!sender) {
        Log.e('kakao-bot[NOTI] 수집 생략 — 발신자를 못 읽음 room="' + roomToSave + '"');
      } else if (!trimText(notiBody) && !notiImage) {
        Log.e('kakao-bot[NOTI] 수집 생략 — 본문이 비었다 room="' + roomToSave
          + '". 카톡·안드로이드 알림 설정에서 내용 미리보기가 꺼져 있으면 이렇게 된다.');
      } else if (msgAt && (_now() - msgAt) > NOTI_STALE_MS) {
        // 카톡은 같은 알림을 다시 올린다. 메시지 자신의 시각이 한참 지난 것이면 이미 처리한
        // 메시지의 재게시로 본다 — 안 그러면 재게시마다 새 ts 가 붙어 중복 저장된다.
        Log.i('kakao-bot[NOTI] 수집 생략 — 재게시(메시지 시각이 '
          + Math.round((_now() - msgAt) / 1000) + '초 전)');
      } else {
        Log.i('kakao-bot[NOTI] 수집 시도 room="' + roomToSave + '"');
        ingestFromNoti(roomToSave, notiBody, sender, isGroup, notiImage,
          msgAt ? isoFromMillis(msgAt) : '');
      }
    }
  } catch (eN) {
    Log.e('kakao-bot[NOTI] 파싱 예외: ' + eN);
  }
}

/**
 * 알림에서 곧바로 수집한다. 알림 콜백은 메인 스레드로 오는 단말이 있어
 * (NetworkOnMainThreadException) 네트워크는 반드시 별도 스레드에서 돈다.
 */
function ingestFromNoti(room, text, sender, isGroup, imageB64, ts) {
  try {
    if (!trimText(text) && !imageB64) return;
    var t = new java.lang.Thread(new java.lang.Runnable({
      run: function () {
        try {
          handleMessage(room, text, sender, isGroup, imageB64, null, null, null, ts);
        } catch (e) { Log.e('kakao-bot[NOTI] 수집 예외: ' + e); }
      }
    }));
    t.setDaemon(true);
    t.start();
  } catch (eT) {
    // 스레드를 못 만들면 조용히 포기한다 — response 콜백 경로가 같은 메시지를 다시 들고 온다.
    Log.e('kakao-bot[NOTI] 수집 스레드 생성 실패: ' + eT);
  }
}

// 구 API 전역 훅. 메신저봇R 이 지원하지 않는 버전이면 그냥 호출되지 않는다(무해).
function onNotificationPosted(sbn) {
  handleKakaoNoti(sbn);
}

// ── 진입점: API2 (권장) ───────────────────────────────────────

// 폰에 실제로 올라간 코드가 어느 것인지 로그 첫 줄로 못 박는다. 붙여넣기가 안 먹었는데
// 먹은 줄 알고 원인을 엉뚱한 데서 찾은 적이 있다(2026-08-12).
Log.i('kakao-bot: 시작 v2026-08-12l DEVICE_FILTER=' + DEVICE_FILTER + ' NOTI_INGEST=' + NOTI_INGEST + ' NOTI_DEBUG=' + NOTI_DEBUG);

readCachedRules();
refreshRules(true);
// 앱이 죽어 있던 동안 밀린 것을 먼저 올린다. 파일 큐가 되는 단말에서만 남아 있다.
flushQueue();
// 대시보드에서 쓴 것을 가져와 방에 넣는 루프. 읽기 경로와 독립적으로 돈다.
startOutboxLoop();

try {
  _api2Why = 'BotManager=' + (typeof BotManager) + ' Event=' + (typeof Event);
  Log.i('kakao-bot: ' + _api2Why);
  if (typeof BotManager !== 'undefined' && BotManager.getCurrentBot) {
    _bot = BotManager.getCurrentBot();
    if (_bot && _bot.on) {
      _bot.on(Event.MESSAGE, function (chat) {
        try {
          _api2Fired = true;

          // chat.room 은 단말/버전에 따라 객체(.name/.chatId)일 수도, 문자열일 수도 있다.
          var rname = '';
          var chId = null;
          var grp = false;
          try {
            var rm = chat.room;
            if (rm !== null && rm !== undefined) {
              if (typeof rm === 'string') {
                rname = rm;
              } else {
                if (rm.name) rname = String(rm.name);
                if (rm.chatId !== undefined && rm.chatId !== null) chId = String(rm.chatId);
                if (rm.isGroupChat) grp = true;
              }
            }
          } catch (eR) {}

          try { if (!chId && chat.channelId !== undefined && chat.channelId !== null) chId = String(chat.channelId); } catch (e1) {}
          try { if (!chId && chat.chatId !== undefined && chat.chatId !== null) chId = String(chat.chatId); } catch (e2) {}
          try { if (!rname && chat.roomName) rname = String(chat.roomName); } catch (e3) {}
          try { if (!grp && chat.isGroupChat) grp = true; } catch (e4) {}

          var logId = null;
          try { if (chat.logId !== undefined && chat.logId !== null) logId = String(chat.logId); } catch (e5) {}

          var sname = '';
          try {
            if (chat.author && chat.author.name) sname = String(chat.author.name);
            else if (chat.sender) sname = String(chat.sender);
          } catch (e6) {}

          var ctext = '';
          try {
            if (chat.content !== undefined && chat.content !== null) ctext = String(chat.content);
            else if (chat.message !== undefined && chat.message !== null) ctext = String(chat.message);
          } catch (e7) {}

          // 긴 메시지 잘림 복원: 카톡이 긴 메시지를 채팅DB에 "펼쳐보기" 축약으로 넣으면 ctext 가
          // 잘린다. 같은 발신자의 최근 알림 bigText(전문)가 더 길면 그걸로 대체한다.
          try {
            var full = _lookupNotiText(sname);
            if (full && full.length > ctext.length) {
              if (ctext.length < 40 || full.indexOf(ctext.slice(0, 20)) >= 0) ctext = full;
            }
          } catch (e8) {}

          // room 이 발신자명이면(단톡방인데 방 제목을 못 읽은 것) 알림에서 찾은 진짜 방 제목으로
          // 교정한다. 접두어 규칙이 걸리려면 방 제목이 정확해야 한다.
          try {
            var realRoom = _lookupNotiRoom(sname, ctext);
            if (realRoom && normRoom(realRoom) !== normRoom(rname)) {
              if (rname === sname || !rname) grp = true;
              rname = realRoom;
            } else if (!realRoom && rname === sname) {
              // 방 제목 복원 실패 — 이 상태로는 규칙이 걸리지 않아 전송되지 않는다.
              // 카톡에서 방 제목을 지정하면 해결된다.
              Log.e('kakao-bot: 방제목 복원 실패 sender=' + sname + ' notiOk=' + _notiOk);
            }
          } catch (e9) {}

          // 메신저봇R 이 이미지를 안 주면 알림에서 꺼내둔 것을 쓴다(실측: 이 단말은 항상 이쪽).
          var isPhoto = looksLikePhoto(ctext);
          var img = extractImage(chat, null, isPhoto);
          if (!img && isPhoto) {
            img = _takeNotiImage(sname);
            if (!img) logPhotoMiss('API2');
          }

          // chat.reply 는 이 이벤트의 알림 세션을 물고 있다. 그대로 넘기지 않고 감싸는 이유는
          // Rhino 에서 메서드만 떼면 this 가 풀리기 때문이다.
          var replyFn = null;
          try { if (chat && chat.reply) replyFn = function (t) { return chat.reply(t); }; } catch (eRp) {}
          rememberReplier(rname, rname, replyFn);

          handleMessage(rname, ctext, sname, grp, img, chId, logId, replyFn);
        } catch (eMain) {
          Log.e('kakao-bot[API2] 처리 예외: ' + eMain);
        }
      });
      _api2 = true;
      Log.i('kakao-bot: API2 리스너 등록 성공');
    }
  }
  if (!_api2) Log.e('kakao-bot: API2 미활성 — 구 API 로 동작');
} catch (e) {
  Log.e('kakao-bot: API2 초기화 예외, 구 API 로 동작 — ' + e);
}

if (_api2) {
  try {
    _bot.on(Event.NOTIFICATION_POSTED, handleKakaoNoti);
    _notiOk = true;
    Log.i('kakao-bot: 알림 기반 방 제목 확보 활성 (API2)');
  } catch (e) {
    Log.e('kakao-bot: NOTIFICATION_POSTED 등록 실패 — ' + e);
  }
}

// ── 진입점: 구 API (폴백) ─────────────────────────────────────
// API2 가 실제로 메시지를 받은 적이 있으면 쓰지 않는다(중복 수집 방지).
// 리스너 등록만 되고 이벤트가 안 오는 단말에서 둘 다 죽는 것을 막기 위해 _api2 가 아니라
// _api2Fired 를 기준으로 판단한다.
//
// 구 API 는 room 에 발신자명을 넣어 넘긴다(실측). API2 쪽과 같은 복원을 여기서도 한다 —
// 이게 없으면 단톡방인데도 말하는 사람마다 room 이 달라져 규칙이 걸리지 않는다.
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  if (_api2Fired) return;

  // 진입 여부를 무조건 남긴다. 실측에서 "알림은 사진을 꺼냈는데 그 뒤 아무 로그도 없는"
  // 상황이 있었다. 이 줄이 안 보이면 메신저봇R 이 그 메시지로 response 를 부르지 않은 것이고,
  // 보이는데 그 뒤가 없으면 아래 어딘가에서 죽은 것이다. 본문은 남기지 않는다.
  var isPhoto = looksLikePhoto(msg);
  Log.i('kakao-bot[구API] 진입 room="' + room + '" sender="' + sender + '" photo=' + isPhoto);

  // 여기서 예외가 나면 메신저봇R 이 조용히 삼켜 원인이 안 보인다. 직접 잡아서 남긴다.
  try {
    var rname = room;
    var grp = isGroupChat;
    var realRoom = _lookupNotiRoom(sender, msg);
    if (realRoom && normRoom(realRoom) !== normRoom(room)) {
      rname = realRoom;
      grp = true;
    }
    if (normRoom(rname) === normRoom(sender)) {
      // 방 이름 자리에 발신자명이 그대로 있다. 1:1 개인 카톡이면 정상이고(규칙에 없으니
      // 수집되지 않는다), 단톡방이면 복원 실패다 — 그 방은 #등록 도 거부된다.
      // notiHook=false 면 이 단말이 onNotificationPosted 를 지원하지 않는 것이고,
      // true 인데 실패면 알림에 방 제목이 없거나 알림 본문이 이 메시지와 맞지 않는 것이다.
      Log.i('kakao-bot[구API] 방 이름 = 발신자명 sender="' + sender + '" notiHook=' + _notiSeen);
    }

    var img = extractImage(null, imageDB, isPhoto);
    if (!img && isPhoto) {
      img = _takeNotiImage(sender);
      if (!img) logPhotoMiss('구API');
    }

    var replyFn = null;
    try { if (replier && replier.reply) replyFn = function (t) { return replier.reply(t); }; } catch (eRp) {}
    // 발신 통로로 걸어둔다. 서버는 교정된 이름으로 내려보내므로 그 이름으로 건다.
    // 수집을 건너뛰더라도 이건 반드시 해둔다 — 구 API 의 replier 가 이 단말의 주 발신 경로다.
    rememberReplier(rname, room, replyFn);

    // 알림 훅에 우선권을 준다. 이 단말에서 구 API 의 room 은 늘 발신자명이라 방 이름이
    // 틀리고, 알림 훅은 열쇠로 제대로 붙인다. 두 경로가 같은 메시지를 각각 올리면 같은 말이
    // 서로 다른 두 방에 쌓이므로, 여기서 잠깐 기다렸다가 알림 훅이 안 가져갔을 때만 올린다.
    // (알림 훅이 죽은 단말에서 수집이 통째로 멈추지 않게 하려는 폴백이다.)
    try { java.lang.Thread.sleep(RESPONSE_YIELD_MS); } catch (eY) {}

    handleMessage(rname, msg, sender, grp, img, null, null, replyFn);
  } catch (e) {
    Log.e('kakao-bot[구API] 처리 예외: ' + e);
  }
}
