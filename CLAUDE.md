# speciai-kakao-bot — Claude 가이드

## 정체

거래처 카카오톡 단톡방을 개인 카톡과 분리해 모아 보는 사내 콘솔. 단독 실행형 Next.js 앱.
`kakao-advisor-bot`(노무사무소용 자문방 수집)의 콘솔 셸·인증·CSS 를 가져오고,
카톡 연동 도메인은 전부 새로 짰다.

**범위 밖**: 자문 답변 초안, 이슈 자동분류, 법령 조문, FAQ 자동응답, 상담톡 채널 webhook,
대화 내보내기 .txt 업로드. advisor 에서 의도적으로 뺀 것들이니 되가져오지 말 것.

## 절대 원칙

1. **개인 카톡은 서버에 도달하지 않는다.** 걸러내는 곳은 서버가 아니라 봇 단말이다.
   "전부 받고 서버에서 버린다" 로 바꾸지 말 것 — 그러면 개인 대화가 서버에 남는다.
2. **fail-closed.** 규칙을 못 받았으면 봇은 아무것도 보내지 않는다. 전부 보내는 쪽으로 실패시키지 말 것.
3. **AI 추론 시스템 아님** — 매칭·멱등·집계는 전부 결정론. Anthropic 의존성이 없다.
4. **봇은 카톡방에 말하지 않는다.** 읽어서 보내기만 한다.

## 스택

- Next.js 15 App Router · React 19 · TypeScript strict
- Supabase (Postgres + Auth + Storage), RLS 워크스페이스 격리
- 모노레포 아님. 경로 별칭 `@/*` → `src/*`

## 방 → 거래처 매칭 (핵심)

우리 단톡방 이름은 `[삼성전자] 3분기 발주` 처럼 접두어 관행이 있다. 그 관행을 규칙으로 등록한다.

| 테이블 | 역할 |
|---|---|
| `partners` | 거래처 |
| `partner_room_rules` | 방 이름 규칙 — `prefix`(기본) / `exact` / `contains` / `regex` |
| `kakao_rooms` | 실제 카톡 방. 규칙에 걸리면 자동 생성 |
| `kakao_messages` | 메시지 |
| `kakao_unmatched_rooms` | 규칙에 안 걸린 방 — **이름과 횟수만**, 본문 저장 안 함 |

매칭 우선순위(`src/server/kakao/rules.ts`): `priority` 큰 것 → 패턴 긴 것 → 사전순.
길이를 두 번째 기준으로 둔 이유는 `[삼성전자 반도체]` 가 `[삼성전자]` 를 이겨야 하기 때문이다.

### ⚠️ 규칙 로직은 두 곳에 있다

`src/server/kakao/rules.ts` 의 `ruleMatches` 와 `bot/speciai-bot.js` 의 `ruleMatches` 는
같은 결과를 내야 한다. 어긋나면 "단말은 보냈는데 서버가 버리는" 방이 생긴다.
문법을 바꾸면 반드시 양쪽을 함께 고치고 `rules.test.ts` 를 갱신할 것.

## 수집 경로

경로는 하나뿐이다 — 온디바이스 봇(메신저봇R).

| 진입점 | 인증 | 용도 |
|---|---|---|
| `POST api/kakao/bot/ingest` | `X-Ingest-Token` | 메시지 1건 인입 |
| `GET api/kakao/bot/rules` | `X-Ingest-Token` | 봇이 받아갈 방 필터 규칙 |

둘 다 세션이 없어 service-role 클라이언트로 RLS 를 우회한다.
워크스페이스는 `KAKAO_WORKSPACE_ID` 로 지정한다(`resolveBotWorkspaceId`).
미설정이면 워크스페이스가 정확히 하나일 때만 폴백하고, 둘 이상이면 **인입을 거부한다** —
엉뚱한 곳에 거래처 대화를 쌓는 것보다 안 받는 편이 낫다.

## 멱등 규칙

`content_hash` = 봇이 `logId`(API2 메시지 id)를 주면 `log:<logId>`, 없으면
`md5(분단위시각|발화자|본문)`. 유니크는 `(room_id, content_hash)`.

advisor 와 달리 **부분 인덱스가 아니라 완전 유니크**라 supabase-js
`upsert(onConflict:'room_id,content_hash', ignoreDuplicates:true)` 가 정상 동작한다.
분 단위로 자른 이유: 봇 재전송·API2/구API 동시 수신 같은 중복은 초 단위로 생기므로 잡히고,
나중에 같은 사람이 같은 말("네")을 다시 해도 별개로 남는다.

## 방 식별

`room_key` = `chat:<chatId>` (API2 가 chatId 를 줄 때) 또는 `name:<정규화된 방이름>`.
chatId 가 있으면 방 제목을 바꿔도 같은 방으로 이어진다.

실측 주의: 메신저봇R 은 NotificationListenerService 기반이라 단말에 따라 `chatId`·`logId` 가
아예 없고 `chat.room` 이 문자열인 경우가 있다. 그 경우 방 이름이 유일한 단서다.
게다가 방 제목 대신 **발신자명**이 오는 단말이 있어, 봇이 알림 원본(`android.conversationTitle`)에서
방 제목을 복원한다. 이 복원을 지우면 접두어 규칙이 걸리지 않아 수집이 통째로 멈춘다.

## 발화자 판정

`workspaces.staff_aliases`(설정 탭에서 등록)에 있는 이름이면 `side='us'`, 아니면 `'partner'`.
부분일치는 3자 이상 별칭에만 적용한다 — "김" 같은 짧은 별칭이 거래처 "김부장" 을 오판정한다.

## 브랜딩

회사 고유 문자열은 전부 `src/lib/brand.ts` + `NEXT_PUBLIC_BRAND_*` 로 뺐다.
새 하드코딩을 넣지 말 것.

## 개인정보

- 거래처 방 대화는 원문 그대로 저장한다(마스킹 없음). 접근 통제는 RLS 에 의존한다.
- 미분류 방은 **방 이름과 수신 횟수만** 남긴다. 본문·발화자는 저장하지 않는다.
- 규칙을 나중에 등록해도 미분류 구간의 지난 대화는 되살아나지 않는다(애초에 저장하지 않았다).
- 각 거래처 방 참여자에게 자동 수집·저장 사실을 사전 고지·동의받아야 한다(개인정보보호법 §15).

## 코딩 규칙

- 파일명·폴더명 kebab-case, Next.js 라우트 컨벤션 우선
- 코드 식별자는 영문. 한국어는 UI 문자열·주석에만
- 주석은 "왜"를 적는다. 코드가 말하는 "무엇"을 반복하지 말 것
- supabase-js 는 쿼리 실패를 throw 하지 않는다 — `error` 를 반드시 보고 로깅할 것
- `bot/speciai-bot.js` 는 Rhino(ES5) 환경이다. 화살표 함수·`let`·`const`·템플릿 리터럴 금지

## 검증

```bash
npm run typecheck && npm test && npm run build
```
