// 관리자 경로 은폐 + 스캐너 허니팟 + 자동화 차단 — Next.js(15·16) 미들웨어 드롭인.
//
// speciai.kr(trend)의 완성형 미들웨어를 DB 없이 엣지만으로 도는 경량판으로 옮긴 것.
// 목적 두 가지:
//   1) 관리자 경로를 "안 걸리게" — 미인증 요청에 404를 주어 존재 자체를 숨긴다.
//      302/401을 주면 "거기 뭔가 있다"가 들통난다. 무조건 사이트 보통 404와 같게.
//   2) 스캐너·관리자탐색·robots함정은 전부 404 + 디스코드 경보. 긁을수록 경보만 쌓인다.
//
// 이건 은폐지 인가가 아니다. 쿠키만 있으면 통과하므로 실제 권한확인은 각 앱의
// requireStaff/세션검증이 그대로 맡는다. 미들웨어는 "존재를 숨기고 소음을 기록"만.
//
// 쓰는 법(앱마다 ADMIN_PREFIXES·SESSION_COOKIES·DECOY만 맞춤):
//   import { hardening } from "@/lib/next-hardening";
//   export function middleware(req, event) {
//     const blocked = hardening(req, event);
//     if (blocked) return blocked;              // 숨김/함정이면 404
//     return NextResponse.next();               // 그 외는 기존 로직
//   }
//   export const config = { matcher: [ ...관리자prefix, ...함정경로 ] }; // 아래 MATCHER 참고
//
// env: INTRUSION_APP(앱 식별 접두)·DISCORD_SECURITY_WEBHOOK(없으면 경보만 생략, 404는 동작)·
//      INTRUSION_SALT(IP 해시 소금)·ADMIN_SLUG(선택: 진짜 관리자 경로를 랜덤 slug로 둘 때)

import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// ── 앱마다 바꾸는 설정 ──────────────────────────────────────────────
// 진짜 관리자 경로. 미인증(세션쿠키 없음) 접근은 404로 숨긴다.
const ADMIN_PREFIXES = (process.env.ADMIN_PREFIXES || "/staff,/admin,/dashboard")
  .split(",").map((s) => s.trim()).filter(Boolean);

// next-auth/supabase 등 세션 쿠키명. 하나라도 있으면 "로그인했을 수 있음"으로 보고 통과.
const SESSION_COOKIE_RE =
  /^(__Secure-)?(authjs\.session-token|next-auth\.session-token|sb-[\w-]+-auth-token)(\.\d+)?$/;

const APP = process.env.INTRUSION_APP || "app";
const LEGAL =
  "Unauthorized access prohibited and logged. Network Act 48/71/72, Criminal Act 314.";
// 한글 법적경고. 트랩 응답 본문에 노출해 "장난이 아님"을 직접 알린다. 조문은 법제처 검증(el-tx 레퍼런스).
const LEGAL_KO =
  "경고: 권한 없는 접근입니다. 이 접근은 발신 정보와 함께 기록되었습니다. " +
  "정당한 권한 없이 정보통신망에 침입하거나(정보통신망법 제48조·제71조·제72조), " +
  "정보처리에 장애를 발생시키는 행위(형법 제314조)는 형사처벌 대상입니다. " +
  "계속할 경우 접속 기록을 수사기관에 제출할 수 있습니다.";

// 사내 대역. 여기서 온 요청은 internal 로 찍어 외부 침입과 섞이지 않게 한다.
// 카페24 203.245.30.*, AX42 하츠너 37.27.120.36. 환경변수로 더 넣을 수 있다(쉼표구분).
const INTERNAL_IP_PREFIXES = (process.env.INTERNAL_IP_PREFIXES || "203.245.30.,37.27.120.36,127.0.0.1,::1")
  .split(",").map((s) => s.trim()).filter(Boolean);

function isInternalIp(ip: string): boolean {
  return INTERNAL_IP_PREFIXES.some((p) => ip === p || ip.startsWith(p));
}
// 앞 3옥텟만 남기고 마스킹(대역 판별은 되되 개인 식별은 막는다).
function maskIp(ip: string): string {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}.x` : (ip.includes(":") ? ip.split(":").slice(0, 3).join(":") + "::x" : ip || "?");
}

// 침입 종류별 심각도. high 는 디스코드에서 @here 로 즉시 깨운다.
const SEVERITY: Record<string, "low" | "med" | "high"> = {
  "scanner-path": "low",
  "robots-trap": "med",
  "admin-probe": "high",
  "admin-geo": "high",
  "admin-hidden-404": "med",
  "injection-probe": "high",
  "decoy-visit": "med",
  "honeypot-hit": "med",
  "canary-replay": "high",
};

// ── 스캐너 상투 경로. 밟으면 신호다(정상 사용자는 올 일 없다). ───────────
const SCANNER_RE: RegExp[] = [
  /^\/wp-(admin|login\.php|content|includes|json|config\.php)/i,
  /^\/xmlrpc\.php$/i,
  /^\/wordpress(\/|$)/i,
  /^\/phpmyadmin/i,
  /^\/(pma|myadmin|dbadmin|adminer|sqlbuddy|mysql)(\.php)?$/i,
  /^\/\.env(\.|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.(svn|hg|bzr)(\/|$)/i,
  /^\/\.(aws|ssh|docker)(\/|$)/i,
  /^\/\.(npmrc|dockercfg|htpasswd|htaccess|DS_Store)$/i,
  /^\/(config|configuration|settings|secrets|credentials)\.(php|json|ya?ml|bak|old|txt|ini)$/i,
  /^\/(docker-compose|Dockerfile|Procfile)(\.ya?ml)?$/i,
  /^\/(backup|backups|dump|db|database|www|public_html|site)\.(sql|zip|tar|tar\.gz|tgz|gz|7z|rar)$/i,
  /^\/[\w.-]+\.(sql|sql\.gz)$/i,
  /^\/(actuator|solr|jenkins|struts|jmx-console|manager\/html)/i,
  /^\/cgi-bin(\/|$)/i,
  /^\/(telescope|horizon|_debugbar)/i,
  /^\/(graphql|graphiql)(\/|$)/i,
  /^\/(server-status|server-info)$/i,
  /^\/(latest\/meta-data|computeMetadata)/i,
  /^\/(shell|c99|r57|wso|alfa|b374k)(\.php)?$/i,
  /^\/vendor\/phpunit/i,
  /^\/HNAP1/i,
];

// 관리자 자리를 이름만 바꿔 두드리는 쪽. 스캐너 소음과 무게가 달라 따로 센다.
const ADMIN_PROBE_RE: RegExp[] = [
  /^\/(administrator|admin-?panel|admin-?console|adminer-?login)(\/|$)/i,
  /^\/(backoffice|back-?office|manage|management|console)(\/|$)/i,
  /^\/(cpanel|whm|plesk|webadmin|siteadmin)(\/|$)/i,
  /^\/(user\/login|auth\/admin|login\.php|signin\.php)$/i,
];

// robots.txt Disallow 에만 적어 둔 미끼. 링크가 없으니 여기 오면 골라 들어온 것.
const ROBOTS_TRAPS = [
  "/internal-backup-2019", "/_staff-tools", "/admin-old",
  "/private/exports", "/data/members-backup", "/api/v1/internal",
];

const DATACENTER_ASNS = new Set([
  "14061", "16509", "14618", "16276", "24940", "15169", "20473", "63949",
]);

function anyMatch(res: RegExp[], p: string): boolean { return res.some((re) => re.test(p)); }
function hasSession(req: NextRequest): boolean {
  return req.cookies.getAll().some((c) => SESSION_COOKIE_RE.test(c.name) && !!c.value);
}

// 404 응답 방식. rewrite 로 사이트 공통 404 화면을 그대로 그리면 길이까지 같아
// 은폐가 완벽하다. 단 대상 라우트(기본 "/_not-found")가 없는 앱이면 500 이 되므로,
// not-found 라우트가 없는 앱은 env NOTFOUND_REWRITE=0 으로 꺼서 표준 404 본문을 쓴다.
const NOTFOUND_PATH = process.env.NOTFOUND_PATH || "/_not-found";
const NOTFOUND_REWRITE = process.env.NOTFOUND_REWRITE !== "0";

/** 사이트 보통 404를 그대로 그린다. 함정만 응답이 다르면 은폐가 무의미하다.
 *  단 법적경고·추적ID는 응답 "헤더"로만 싣는다 — 본문을 바꾸면 길이가 달라져 은폐가 깨지므로,
 *  본문은 평범한 404 그대로 두고 X-Legal-Notice·X-Trace 헤더로 "기록·추적됨"을 알린다. */
function notFound(req: NextRequest, trace?: string): NextResponse {
  let res: NextResponse;
  if (NOTFOUND_REWRITE) {
    const url = req.nextUrl.clone();
    url.pathname = NOTFOUND_PATH;
    url.search = "";
    res = NextResponse.rewrite(url, { status: 404 });
  } else {
    res = new NextResponse("404 Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  res.headers.set("X-Legal-Notice", LEGAL);
  res.headers.set("X-Legal-Notice-KR", encodeURIComponent(LEGAL_KO));
  if (trace) res.headers.set("X-Trace", trace);
  return res;
}

// 허니팟(가짜 로그인·가짜 .env 등 "응답을 보여 주는" 미끼)에는 법적경고를 본문에 직접 노출한다.
// 여기선 은폐가 목적이 아니라 억지 — "장난 아니다"를 읽게 만든다.
export function legalDecoy(trace: string, ctype = "text/html"): NextResponse {
  const body = ctype.includes("html")
    ? `<!doctype html><meta charset=utf-8><title>Access logged</title>` +
      `<pre style="font:14px/1.6 monospace;padding:24px;white-space:pre-wrap">${LEGAL_KO}\n\n${LEGAL}\n\nTRACE-ID: ${trace}</pre>`
    : `${LEGAL_KO}\n\n${LEGAL}\n\nTRACE-ID: ${trace}\n`;
  const res = new NextResponse(body, {
    status: 403,
    headers: { "content-type": `${ctype}; charset=utf-8`, "cache-control": "no-store", "X-Trace": trace },
  });
  res.headers.set("X-Legal-Notice", LEGAL);
  return res;
}

/** 기록은 응답을 붙잡지 않는다. waitUntil로 "응답 먼저, 기록은 끝까지". */
// 통일 로그 1줄. 모든 자사 앱이 같은 필드로 남긴다 — 내부/외부·유출여부를 한 포맷으로 본다.
// leaked: 이 응답에 진짜 데이터가 나갔는가. 트랩/404 은폐는 전부 false(가짜·빈 응답).
//   실제 유출은 미들웨어가 아니라 각 앱 라우트가 판단해 logEvent(...,{leaked:true})로 남긴다.
export interface SecEvent {
  app: string; kind: string; ts: string;
  ip: string; country: string; asn: string; internal: boolean;
  outcome: "blocked" | "decoy" | "logged"; leaked: boolean;
  severity: "low" | "med" | "high"; path: string; method: string; ua: string;
  referer: string; lang: string;
  // 추적ID. IP+UA+accept-language+ASN 지문을 섞은 비암호 해시 — 같은 공격자는 요청마다 같은 값.
  // 원문 IP 없이도 "같은 자가 또 왔다"를 묶어 추적한다. 수사 제출 시 Vercel 원본 로그와 대조.
  trace: string;
  // 카나리 토큰(미끼로 심은 가짜 키)이 로그인·API 입력에 되돌아왔는가. true면 "미끼 삼킨 자가 재침입" = 침입 확증.
  canary?: boolean;
  hint?: string;
}

// 엣지 동기 지문 해시(djb2). crypto.subtle 는 async 라 응답을 늦추므로 추적ID엔 안 쓴다.
function traceId(parts: string[]): string {
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h.toString(16).padStart(8, "0") + APP.slice(0, 3)).toUpperCase();
}

function buildEvent(req: NextRequest, kind: string, outcome: SecEvent["outcome"], leaked: boolean, hint?: string): SecEvent {
  const h = req.headers;
  const ipRaw = (h.get("x-real-ip") || h.get("x-forwarded-for") || "").split(",")[0]?.trim() ?? "";
  const ua = (h.get("user-agent") || "-");
  const lang = h.get("accept-language") || "-";
  const asn = h.get("x-vercel-ip-asn") || "-";
  return {
    app: APP, kind, ts: new Date().toISOString(),
    ip: maskIp(ipRaw), country: h.get("x-vercel-ip-country") || "?", asn, internal: isInternalIp(ipRaw),
    outcome, leaked, severity: SEVERITY[kind] ?? "low",
    path: req.nextUrl.pathname.slice(0, 200), method: req.method, ua: ua.slice(0, 120),
    referer: (h.get("referer") || "-").slice(0, 120), lang: lang.slice(0, 40),
    trace: traceId([ipRaw, ua, lang, asn]),
    ...(hint ? { hint } : {}),
  };
}

// 침입 종류 한글 라벨·"무엇에 걸렸나"를 사람이 읽게. 전 서비스가 같은 말로 쓴다.
const KIND_LABEL: Record<string, string> = {
  "scanner-path": "스캐너 상투경로",
  "robots-trap": "robots 미끼 적중",
  "admin-probe": "관리자 주소 탐색",
  "admin-geo": "관리자 경로 해외·데이터센터 접근",
  "admin-hidden-404": "숨긴 관리자경로 미인증 접근",
  "decoy-visit": "미끼 구역 방문",
  "injection-probe": "주입 공격 시도",
  "honeypot-hit": "허니팟 미끼 삼킴",
  "canary-replay": "카나리 토큰 회수(미끼 삼킨 자가 재침입)",
};
// 심각도→색상(디스코드 embed 왼쪽 띠).
const SEV_COLOR: Record<string, number> = { low: 0x9aa3b2, med: 0xb26a00, high: 0xc0362c };
const SEV_LABEL: Record<string, string> = { low: "낮음", med: "주의", high: "위험" };

/** 통일 포맷 보안이벤트를 남긴다 — 콘솔 1줄(JSON) + 디스코드 embed(건당). 전 서비스 동일 스타일. */
export function logEvent(ev: SecEvent, event?: NextFetchEvent): void {
  // 콘솔은 Vercel 로그에 그대로 남아 사후 집계·검색이 된다. 접두로 필터링.
  console.log(`[sec] ${JSON.stringify(ev)}`);
  const url = process.env.DISCORD_SECURITY_WEBHOOK || process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const embed = toEmbed(ev);
  const ping = ev.severity === "high" && !ev.internal ? "@here" : "";
  const sent = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "침입 감시",
      content: ping,
      embeds: [embed],
      allowed_mentions: { parse: ping ? ["everyone"] : [] },
    }),
  }).catch(() => {});
  if (event) event.waitUntil(sent); else void sent;
}

/** SecEvent → 디스코드 embed. 미끼 적중·카나리 회수·내부외부·추적ID를 필드로 구조화. */
export function toEmbed(ev: SecEvent): Record<string, unknown> {
  const label = KIND_LABEL[ev.kind] ?? ev.kind;
  const scope = ev.internal ? "🏠 내부" : "🌐 외부";
  const decoyHit = ev.kind === "honeypot-hit" || ev.kind === "robots-trap" || ev.kind === "decoy-visit";
  const canaryHit = ev.kind === "canary-replay" || ev.canary;
  return {
    title: `🕸 ${label}${ev.leaked ? " · ❗데이터 유출" : ""}`,
    color: ev.leaked ? 0xc0362c : (SEV_COLOR[ev.severity] ?? 0x9aa3b2),
    fields: [
      { name: "서비스", value: ev.app, inline: true },
      { name: "구분", value: `${scope} · ${SEV_LABEL[ev.severity] ?? ev.severity}`, inline: true },
      { name: "추적ID", value: "`" + ev.trace + "`", inline: true },
      { name: "경로", value: "`" + ev.path + "`  (" + ev.method + ")" },
      { name: "출처", value: `IP \`${ev.ip}\` · ${ev.country} · ASN ${ev.asn}`, inline: true },
      { name: "대응", value: ev.outcome === "blocked" ? "차단(404)" : ev.outcome === "decoy" ? "가짜응답" : "기록", inline: true },
      { name: "미끼 적중", value: decoyHit ? "✅ 미끼에 걸림" : "—", inline: true },
      { name: "카나리 회수", value: canaryHit ? "🚨 미끼 토큰이 되돌아옴(침입 확증)" : "—", inline: true },
      { name: "UA", value: "`" + ev.ua + "`" },
      ...(ev.referer && ev.referer !== "-" ? [{ name: "referer", value: "`" + ev.referer + "`" }] : []),
      ...(ev.hint ? [{ name: "힌트", value: "`" + ev.hint + "`" }] : []),
    ],
    footer: { text: `${ev.ts} · 정보통신망법 48/71/72·형법 314 기록` },
  };
}

// 기록하고 추적ID를 돌려준다 — 404 응답 헤더에 실어 "추적됨"을 남긴다.
function report(req: NextRequest, kind: string, event?: NextFetchEvent, hint?: string): string {
  const outcome: SecEvent["outcome"] = kind === "decoy-visit" ? "logged" : "blocked";
  const ev = buildEvent(req, kind, outcome, false, hint);
  logEvent(ev, event);
  return ev.trace;
}

/** 숨김/함정이면 404 NextResponse, 아니면 null(기존 로직으로 흘려보냄). */
export function hardening(req: NextRequest, event?: NextFetchEvent): NextResponse | null {
  const { pathname } = req.nextUrl;

  if (anyMatch(SCANNER_RE, pathname)) return notFound(req, report(req, "scanner-path", event));
  if (ROBOTS_TRAPS.some((t) => pathname === t || pathname.startsWith(t + "/"))) {
    return notFound(req, report(req, "robots-trap", event));
  }
  if (anyMatch(ADMIN_PROBE_RE, pathname)) return notFound(req, report(req, "admin-probe", event));

  // 진짜 관리자 경로 은폐: 세션쿠키 없으면 404. 있으면 통과(권한확인은 앱이 맡음).
  const isAdmin = ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isAdmin) {
    const country = req.headers.get("x-vercel-ip-country");
    const asn = req.headers.get("x-vercel-ip-asn");
    if ((country && country !== "KR") || (asn && DATACENTER_ASNS.has(asn))) report(req, "admin-geo", event);
    if (!hasSession(req)) return notFound(req, report(req, "admin-hidden-404", event));
  }
  return null;
}

export function legalHeaders<T extends NextResponse>(res: T): T {
  res.headers.set("X-Legal-Notice", LEGAL);
  return res;
}

// 미끼로 심은 카나리 토큰(가짜 .env·가짜 git·허니팟 응답에 박아 둔 가짜 키). 진짜 어디에도 안 쓴다.
// 이 값이 로그인·API 입력으로 "되돌아오면" 미끼를 삼킨 자가 그 키로 침입을 시도한 것 = 확증.
// 앱마다 env INTRUSION_CANARY 로 접두를 바꾼다.
const CANARY = (process.env.INTRUSION_CANARY || "app_live_sk") + "_9d2f0a7c413e86b5";
export function canaryValue(): string { return CANARY; }

/** 로그인·API 라우트에서 입력값이 미끼 토큰이면 canary-replay 로 기록(최고 심각도). 침입 확증 신호. */
export function checkCanary(req: NextRequest, value: string | null | undefined, event?: NextFetchEvent): boolean {
  if (!value || !value.includes(CANARY.slice(0, 20))) return false;
  const ev = buildEvent(req, "canary-replay", "logged", false);
  ev.canary = true;
  logEvent(ev, event);
  return true;
}

/** 미끼 응답을 "보여 주는" 라우트(가짜 로그인·가짜 .env)에서 적중을 기록. honeypot-hit. */
export function reportHoneypot(req: NextRequest, event?: NextFetchEvent, hint?: string): string {
  const ev = buildEvent(req, "honeypot-hit", "decoy", false, hint);
  logEvent(ev, event);
  return ev.trace;
}

// 참고용 matcher. 전 경로 매칭은 CDN 캐시를 죽이므로 함정+관리자 자리만 훑는다.
export const MATCHER = [
  "/staff", "/staff/:path*", "/admin", "/admin/:path*", "/dashboard", "/dashboard/:path*",
  "/wp-admin", "/wp-admin/:path*", "/wp-login.php", "/wp-content/:path*", "/wp-includes/:path*",
  "/wp-json/:path*", "/wordpress/:path*", "/xmlrpc.php", "/wp-config.php",
  "/phpmyadmin", "/phpmyadmin/:path*", "/pma", "/myadmin", "/dbadmin", "/adminer",
  "/.env", "/.env.:path*", "/.git", "/.git/:path*", "/.svn/:path*", "/.aws/:path*", "/.ssh/:path*",
  "/.npmrc", "/.htpasswd", "/.htaccess", "/.DS_Store", "/docker-compose.yml", "/Dockerfile",
  "/cgi-bin", "/cgi-bin/:path*", "/actuator", "/actuator/:path*", "/solr", "/solr/:path*",
  "/jenkins", "/jenkins/:path*", "/telescope/:path*", "/horizon/:path*", "/graphql", "/graphiql",
  "/server-status", "/server-info", "/shell.php", "/c99.php", "/wso.php", "/vendor/phpunit/:path*", "/HNAP1",
  "/administrator", "/administrator/:path*", "/admin-panel", "/adminpanel", "/admin-console",
  "/backoffice", "/back-office", "/manage", "/management", "/cpanel", "/whm", "/plesk",
  "/webadmin", "/siteadmin", "/login.php", "/signin.php",
  "/internal-backup-2019", "/_staff-tools", "/admin-old", "/admin-old/:path*",
  "/private/exports", "/private/exports/:path*", "/data/members-backup", "/data/members-backup/:path*",
  "/api/v1/internal", "/api/v1/internal/:path*",
];
