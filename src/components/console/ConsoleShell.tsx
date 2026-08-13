'use client';

// 거래처 카톡 통합 콘솔 SPA 셸. 상단 헤더 + 가로 네비(탭) 구조.
// 세션·워크스페이스 가드는 상위 layout(서버)이 처리.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconDefs, Ic } from './IconDefs';
import { CV2_NAV_EVENT, type Cv2NavDetail } from './nav';
import { TabActiveProvider } from './tab-active';
import { KakaoAlertsProvider, type KakaoAlerts } from './alerts';

export type ViewKey = 'kakao' | 'partners' | 'link' | 'settings';

const NAV: { key: ViewKey; icon: string; label: string; adminOnly?: boolean }[] = [
  { key: 'kakao', icon: 'i-bubble', label: '받은 카톡' },
  { key: 'partners', icon: 'i-collect', label: '거래처' },
  { key: 'link', icon: 'i-pen', label: '봇 연동' },
  { key: 'settings', icon: 'i-gear', label: '설정', adminOnly: true },
];

export interface ConsoleSlots {
  kakao: ReactNode;
  partners: ReactNode;
  link: ReactNode;
  settings: ReactNode;
}

export function ConsoleShell({
  slots,
  brandName,
  brandMark,
  brandSub,
  userName,
  userRole,
  badges,
  isAdmin = false,
  initialView = 'kakao',
  signOutAction,
}: {
  slots: ConsoleSlots;
  brandName: string;
  brandMark: string;
  brandSub: string;
  userName: string;
  userRole: string;
  badges?: { kakao?: number };
  isAdmin?: boolean;
  initialView?: ViewKey;
  /** 서버 액션. 세션을 지우고 sign-in 으로 리다이렉트한다 */
  signOutAction: () => Promise<void>;
}) {
  const [view, setView] = useState<ViewKey>(initialView);
  // 한 번이라도 연 탭은 계속 살려둔다. 탭을 옮길 때마다 언마운트하면 그 화면의 상태가 전부
  // 사라지고(방 목록·불러온 대화·쓰다 만 초안·스크롤·폴링으로 받아둔 최신 목록), 돌아왔을 때
  // 페이지를 처음 열던 시점의 값으로 되돌아간다. 폴링 타이머도 0부터 다시 시작해 첫 갱신을
  // 또 기다리게 된다.
  //
  // 처음부터 전부 그리지 않는 이유는 그대로다 — 첫 화면이 느려지고, 코드분할(dynamic import)
  // 해둔 탭의 청크를 안 볼 사람도 받게 된다. 안 보는 탭은 CSS(.view{display:none})가 감추고,
  // 폴링은 TabActiveProvider 가 멈춘다.
  const [visited, setVisited] = useState<ViewKey[]>([initialView]);
  const [signingOut, setSigningOut] = useState(false);

  // 미처리 수는 서버가 준 값에서 출발해 받은 카톡 뷰의 폴링이 갱신한다. 예전에는 서버 값이
  // 그대로 굳어 있어 방을 처리완료로 바꾸거나 새 카톡이 와도 새로고침 전까지 숫자가 안 변했다.
  const [unhandled, setUnhandled] = useState(badges?.kakao ?? 0);
  const [toast, setToast] = useState<{ seq: number; title: string; body: string } | null>(null);
  const toastSeq = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const alerts = useMemo<KakaoAlerts>(
    () => ({
      setUnhandled,
      notify: ({ title, body }) => {
        toastSeq.current += 1;
        setToast({ seq: toastSeq.current, title, body });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        // 업무 화면이라 알림이 화면을 계속 가리면 안 된다. 6초 뒤 스스로 사라진다.
        toastTimer.current = window.setTimeout(() => setToast(null), 6000);
      },
    }),
    [],
  );

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // 브라우저 탭 제목에도 미처리 수를 적는다. 사무실에서 이 화면은 대개 뒤에 깔려 있어서,
  // 화면 안에만 표시하면 보러 오기 전까지 아무도 모른다.
  const baseTitle = useRef('');
  useEffect(() => {
    baseTitle.current = document.title;
    return () => {
      if (baseTitle.current) document.title = baseTitle.current;
    };
  }, []);
  useEffect(() => {
    if (!baseTitle.current) return;
    document.title = unhandled > 0 ? `(${unhandled}) ${baseTitle.current}` : baseTitle.current;
  }, [unhandled]);

  const avatar = userName.charAt(0) || '·';
  const navItems = NAV.filter((n) => !n.adminOnly || isAdmin);

  // 탭 버튼·navigateConsole 어느 쪽으로 옮겨왔든 한 곳에서 기록한다.
  useEffect(() => {
    setVisited((prev) => (prev.includes(view) ? prev : [...prev, view]));
  }, [view]);

  // 뷰 간 이동(navigateConsole) 수신 → 탭 전환.
  useEffect(() => {
    function onNav(e: Event) {
      const detail = (e as CustomEvent<Cv2NavDetail>).detail;
      if (!detail?.view) return;
      setView(detail.view as ViewKey);
      if (detail.params) {
        // 대상 뷰가 파라미터를 쓸 수 있게 세션 스토리지에 임시 보관.
        try {
          sessionStorage.setItem(`cv2:params:${detail.view}`, JSON.stringify(detail.params));
        } catch {
          /* noop */
        }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener(CV2_NAV_EVENT, onNav);
    return () => window.removeEventListener(CV2_NAV_EVENT, onNav);
  }, []);

  return (
    <div className="console-v2">
      <IconDefs />

      {/* floating 상단바: 브랜드 · 네비 · 계정 한 줄 */}
      <header className="cv2-top">
        <div className="cv2-top-inner">
          <div className="cv2-brand">
            <span className="mark">{brandMark}</span>
            <span className="tx">
              <b>{brandName}</b>
              <span>{brandSub}</span>
            </span>
          </div>

          <nav className="cv2-nav-inner">
            {navItems.map((n) => {
              const badge = n.key === 'kakao' ? unhandled : undefined;
              return (
                <button
                  key={n.key}
                  type="button"
                  className={`cv2-tab${view === n.key ? ' on' : ''}`}
                  onClick={() => setView(n.key)}
                >
                  <Ic id={n.icon} w={16} />
                  <span className="lb">{n.label}</span>
                  {badge ? <span className="bdg">{badge}</span> : null}
                </button>
              );
            })}
          </nav>

          <div className="cv2-user">
            <span className="tx">
              <b>{userName}</b>
              <span>{userRole}</span>
            </span>
            <span className="av">{avatar}</span>
            <button
              type="button"
              className="cv2-logout"
              title="로그아웃"
              aria-label="로그아웃"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  // 액션 안에서 redirect 하므로 정상 흐름에서는 여기로 돌아오지 않는다.
                  await signOutAction();
                } finally {
                  setSigningOut(false);
                }
              }}
            >
              <Ic id="i-out" w={16} />
            </button>
          </div>
        </div>
      </header>

      {/* 콘텐츠 */}
      <main className="cv2-main">
        <div className="inner" style={{ paddingBottom: 48 }}>
          {navItems.map((n) => (
            <section key={n.key} className={`view${view === n.key ? ' on' : ''}`} id={`v-${n.key}`}>
              {visited.includes(n.key) ? (
                <TabActiveProvider value={view === n.key}>
                  <KakaoAlertsProvider value={alerts}>{slots[n.key]}</KakaoAlertsProvider>
                </TabActiveProvider>
              ) : null}
            </section>
          ))}
        </div>
      </main>

      {/* 새 카톡 알림. 누르면 받은 카톡으로 간다 — 방금 온 방이 목록 맨 위에 있다. */}
      {toast ? (
        <button
          key={toast.seq}
          type="button"
          className="toast on"
          onClick={() => {
            setView('kakao');
            setToast(null);
          }}
        >
          <Ic id="i-bubble" w={15} />
          <span className="tx">
            <b>{toast.title}</b> {toast.body}
          </span>
        </button>
      ) : null}
    </div>
  );
}
