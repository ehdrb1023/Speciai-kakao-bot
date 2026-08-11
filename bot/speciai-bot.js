/**
 * 거래처 카톡 수집 봇 (메신저봇R · Android)
 * ------------------------------------------------------------------
 * 이 스크립트는 메신저봇R(Android) 앱에 등록해 업무 전용 단말에서 실행한다.
 * 봇 계정을 거래처 단톡방에 초대하면, 그 방 메시지를 서버로 보낸다.
 *
 * ★ 이 봇은 어떤 경우에도 카톡방에 말하지 않는다. 읽어서 보내기만 한다.
 *   자동응답이 없으므로 카카오의 자동화 탐지에 걸릴 여지도 그만큼 줄어든다.
 *
 * ★ 개인 카톡 보호 — 이것이 이 봇의 핵심이다.
 *   서버에서 "연결된 방" 목록을 주기적으로 내려받아, 그 방만 서버로 전송한다.
 *   목록에 없는 방(개인 카톡·가족방·동창방)은 단말 밖으로 한 글자도 나가지 않는다.
 *   규칙을 한 번도 못 받았으면 아무것도 보내지 않는다(fail-closed).
 *   "전부 보내고 서버에서 거른다" 가 아니다 — 그러면 개인 대화가 서버에 도달한다.
 *   유일한 예외는 등록 명령 두 종류다(아래).
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
 *        ← { ok, inserted, skipped, unmatched?, registered?, unregistered? }
 *          registered/unregistered 가 오면 규칙을 즉시 다시 받아온다.
 *
 * 설치:
 *   1) Play스토어 "메신저봇R" 설치 → 알림 접근 권한·배터리 최적화 해제 허용
 *   2) 봇 새로 만들기 → 이 파일 내용 전체 붙여넣기(기존 코드 싹 지우고)
 *   3) 아래 설정 3줄 채우기 → 컴파일 ON → 봇 계정으로 거래처 방 초대 → 방에서 #등록
 *
 * ※ API2(BotManager + Event.MESSAGE) 우선. v0.7.29a 이상에서 동작한다.
 *   메신저봇R 은 알림 파싱 기반이라 단말에 따라 방 제목 대신 발신자명이 오는 경우가 있다.
 *   그 상태로는 규칙 매칭이 불가능하므로 알림 원본(conversationTitle)에서 방 제목을 복원한다.
 */

// ── 설정 (여기 3줄만 채우면 됨) ────────────────────────────────
//
// ⚠️ TOKEN 을 채운 파일은 커밋하지 말 것. 이 파일은 플레이스홀더 상태로만 저장소에 둔다.
//    값을 채워 보관하려면 bot/speciai-bot.local.js 로 복사해서 쓴다(.gitignore 처리됨).
//    실제 단말에는 메신저봇R 앱에 직접 붙여넣으므로 저장소에 채운 사본을 둘 이유가 없다.
var ENDPOINT = 'https://<배포도메인>/api/kakao/bot/ingest';
var RULES_ENDPOINT = 'https://<배포도메인>/api/kakao/bot/rules';
var TOKEN = '<KAKAO_INGEST_TOKEN>'; // 서버 env KAKAO_INGEST_TOKEN 과 같은 값

// ── 동작 옵션 ─────────────────────────────────────────────────
var HANDLE_GROUP_ONLY = false;      // true 면 단톡방만. 일부 단말이 단톡방을 1:1 로 넘겨 기본은 false.
var SEND_TIMEOUT_MS = 8000;
var RULES_REFRESH_MS = 10 * 60 * 1000;  // 규칙 갱신 주기(10분)
var RULES_CACHE_FILE = 'sq-kakao-rules.json'; // 앱 재시작 후에도 규칙을 유지하기 위한 캐시

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
function nowIso() {
  try {
    var fmt = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS");
    fmt.setTimeZone(java.util.TimeZone.getTimeZone('UTC'));
    return String(fmt.format(new java.util.Date())) + 'Z';
  } catch (e) {
    try { return new Date().toISOString(); } catch (e2) { return ''; }
  }
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
    if (code >= 200 && code < 300) return { ok: true, body: body };
    if (code >= 400 && code < 500 && code !== 429) {
      Log.e('kakao-bot POST 영구실패 code=' + code + ' — 재시도하지 않음');
      return { ok: false, retry: false, body: body };
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
function handleMessage(room, msg, sender, isGroupChat, imageB64, chatId, logId) {
  if (HANDLE_GROUP_ONLY && !isGroupChat) return;

  // 메시지가 도착한 시각을 여기서 못 박는다. 큐에 들어가 나중에 보내도 이 값이 따라간다.
  var ts = nowIso();

  var text = trimText(msg);
  var hasText = text.length > 0;
  if (!hasText && !imageB64) return; // 입장·퇴장 같은 시스템 메시지

  // 새 메시지를 보내기 전에 밀린 것을 먼저 비운다. 순서를 지키기 위한 것이기도 하고,
  // 타이머 없이 재시도를 굴리는 유일한 방법이기도 하다(메신저봇R 에서 타이머 스레드는
  // 스크립트를 다시 컴파일할 때 죽는다).
  flushQueue();

  refreshRules(false);

  if (!_rulesEverLoaded) {
    // 서버에 한 번도 닿지 못한 상태. 여기서 다 보내면 개인 카톡이 새어 나간다. 아무것도 안 보낸다.
    Log.e('kakao-bot: 규칙 미수신 — 전송 보류 room="' + room + '"');
    return;
  }

  // 규칙 밖 방이어도 등록 명령 한 종류만은 올려보낸다. 그러지 않으면 아직 등록되지 않은
  // 방에서 "#등록" 을 쳐도 단말이 먼저 버려 영원히 등록할 수 없다.
  var cmd = isRoomCommand(text);

  if (!isAllowedRoom(room) && !cmd) {
    // 규칙에 없는 방 = 개인 카톡. 로그에도 방 이름만 남기고 본문은 남기지 않는다.
    Log.i('kakao-bot: 규칙 밖 방 스킵 room="' + room + '"');
    return;
  }

  // 명령은 사진을 함께 올리지 않는다 — 서버가 저장하지 않고 버리므로 보낼 이유가 없다.
  var obj = buildPayloadObj(room, sender, text, cmd ? null : imageB64, chatId, logId, ts);
  var res = postPayload(obj);
  if (!res.ok && res.retry) enqueue(obj);
}

// ── 알림에서 진짜 방 제목 확보 ────────────────────────────────
// 카톡 알림(MessagingStyle)은 title 에 발신자명을, conversationTitle/subText 에 방 제목을 넣는다.
// 메신저봇R 이 title 만 읽어 room 으로 넘기는 단말이 있어, 그 경우 단톡방인데도 말한 사람마다
// room 이 달라진다. 그 상태로는 접두어 규칙이 걸릴 수 없으므로 알림 원본에서 방 제목을 복원한다.
var _notiBySender = {};
var _notiLast = null;
var _notiOk = false;
var NOTI_TTL_MS = 15000;

/**
 * 알림 1건을 기억한다. 발신자 → 방 제목·본문·사진.
 *
 * ⚠️ 어떤 필드도 직전 기록에서 물려받지 않는다. 실측(2026-08-11)에서 물려받기가
 * 개인 카톡 유출을 만들었다:
 *   1) 신동규가 [테스트상자] 발주 방에서 말함 → _notiBySender["신동규"].room = 그 방
 *   2) 같은 사람과의 1:1 개인 카톡 → 1:1 알림에는 conversationTitle 이 없어 room 이 빈 값
 *   3) 빈 값이면 이전 방을 물려받도록 되어 있어 → 개인 대화가 거래처 방으로 전송됨
 *
 * "방 제목이 없다" 와 "같은 방인데 알림에 제목이 빠졌다" 는 알림만 보고 구별할 수 없다.
 * 구별할 수 없으면 추측하지 않는다 — 그게 fail-closed 다. 제목을 못 얻으면 그 메시지는
 * 규칙에 걸리지 않아 전송되지 않고, 그쪽이 훨씬 안전하다.
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

function _lookupNotiRoom(sender, msgText) {
  var now = _now();
  if (sender) {
    var r = _notiBySender[String(sender)];
    if (r && r.room && (now - r.at) < NOTI_TTL_MS && _notiTextMatches(r.text, msgText)) {
      return r.room;
    }
  }
  // 직전 알림이 아주 최근(1.5초 이내)이면 그 방으로 본다. 본문 대조는 여기서도 요구한다.
  if (_notiLast && _notiLast.room && (now - _notiLast.at) < 1500
      && _notiTextMatches(_notiLast.text, msgText)) {
    return _notiLast.room;
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
// 메신저봇R 은 알림의 android.title 만 읽어 room 으로 넘긴다. 단톡방에서 그 값은 발신자명이라
// 접두어 규칙이 걸릴 수 없다. 여기서 알림 원본을 직접 읽어 진짜 방 제목을 기억해 둔다.
// API2 는 Event.NOTIFICATION_POSTED 로, 구 API 는 전역 onNotificationPosted 로 들어온다.
var _api2 = false;      // 리스너 등록 성공 여부
var _api2Fired = false; // API2 로 메시지를 실제로 1건이라도 받았는지
var _api2Why = '';      // API2 가 안 켜진 이유(진단용)
var _notiSeen = false;  // 알림 훅이 한 번이라도 불렸는지 — 복원 실패 원인 구분용
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

function handleKakaoNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (ep) {}
    if (pkg.indexOf('kakao') < 0) return;

    var ex = sbn.getNotification().extras;
    function gs(key) {
      try {
        var v = ex.get(key);
        if (v === null || v === undefined) return '';
        return String(v);
      } catch (e) { return ''; }
    }
    var ntitle = gs('android.title');            // 발신자명
    var convo = gs('android.conversationTitle'); // 방 제목(카톡에서 이름을 지정한 방만)
    var sub = gs('android.subText');             // 단말에 따라 여기에 방 제목이 온다
    var notiBody = gs('android.bigText') || gs('android.text');

    // 훅이 도는지 한 번만 남긴다. 본문은 남기지 않는다 — 개인 카톡이 로그에 쌓인다.
    if (!_notiSeen) {
      _notiSeen = true;
      Log.i('kakao-bot[NOTI] 훅 동작 확인 title="' + ntitle + '" convo="' + convo + '" sub="' + sub + '"');
    }

    var realRoom = convo || sub;
    var roomToSave = (realRoom && realRoom !== ntitle) ? realRoom : '';

    // 사진은 "규칙에 걸리는 방" + "사진 알림" 일 때만 꺼낸다.
    //
    // 방을 먼저 확인하는 이유가 핵심이다 — 개인 카톡·가족방 사진까지 디코딩하면
    // 전송은 안 하더라도 개인 사진이 이 단말의 메모리를 거치게 된다. 그럴 이유가 없다.
    // 비트맵 디코딩·리사이즈가 무거운 작업이라는 점도 있다.
    var notiImage = null;
    if (roomToSave && looksLikePhoto(notiBody) && isAllowedRoom(roomToSave)) {
      notiImage = extractNotiImage(ex);
    }

    // 방 제목이 발신자명과 같으면 방 이름으로 저장하지 않는다(그건 방 제목이 아니다).
    // 본문 전문은 잘림 복원에 쓰이므로 그래도 남긴다.
    _rememberNoti(ntitle, roomToSave, notiBody, notiImage);
  } catch (eN) {
    Log.e('kakao-bot[NOTI] 파싱 예외: ' + eN);
  }
}

// 구 API 전역 훅. 메신저봇R 이 지원하지 않는 버전이면 그냥 호출되지 않는다(무해).
function onNotificationPosted(sbn) {
  handleKakaoNoti(sbn);
}

// ── 진입점: API2 (권장) ───────────────────────────────────────

readCachedRules();
refreshRules(true);
// 앱이 죽어 있던 동안 밀린 것을 먼저 올린다. 파일 큐가 되는 단말에서만 남아 있다.
flushQueue();

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
            if (realRoom) {
              if (rname === sname || !rname) grp = true;
              rname = realRoom;
            } else if (rname === sname) {
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

          handleMessage(rname, ctext, sname, grp, img, chId, logId);
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
    if (realRoom) {
      rname = realRoom;
      grp = true;
    } else if (room === sender) {
      // 복원 실패 — 이 상태로는 규칙이 걸리지 않아 전송되지 않는다.
      // notiHook=false 면 이 단말이 onNotificationPosted 를 지원하지 않는 것이고,
      // true 인데 실패면 방 제목이 없거나 알림 본문이 이 메시지와 맞지 않는 것이다.
      Log.e('kakao-bot[구API] 방제목 복원 실패 sender="' + sender + '" notiHook=' + _notiSeen);
    }

    var img = extractImage(null, imageDB, isPhoto);
    if (!img && isPhoto) {
      img = _takeNotiImage(sender);
      if (!img) logPhotoMiss('구API');
    }

    handleMessage(rname, msg, sender, grp, img, null, null);
  } catch (e) {
    Log.e('kakao-bot[구API] 처리 예외: ' + e);
  }
}
