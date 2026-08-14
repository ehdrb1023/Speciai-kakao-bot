'use client';

// 거래처 카톡 통합 콘솔 SPA 셸 — 상단 네비(탭) + 탭별 히어로(제목·지표) 구조.
// 세션·워크스페이스 가드는 상위 layout(서버)이 처리.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CV2_NAV_EVENT, type Cv2NavDetail } from './nav';
import { TabActiveProvider } from './tab-active';
import { KakaoAlertsProvider, type KakaoAlerts } from './alerts';

export type ViewKey = 'kakao' | 'partners' | 'link' | 'settings';

const NAV: { key: ViewKey; label: string; adminOnly?: boolean }[] = [
  { key: 'kakao', label: '받은 카톡' },
  { key: 'partners', label: '거래처' },
  { key: 'link', label: '연결 진단' },
  { key: 'settings', label: '설정', adminOnly: true },
];

export interface HeroStat {
  k: string;
  v: string;
  unit?: string;
  alert?: boolean;
  /** 'unhandled' 면 서버 값 대신 받은 카톡 폴링이 갱신하는 미처리 수를 보여준다. */
  live?: 'unhandled';
}

export interface HeroDef {
  eyebrow: string;
  title: string;
  lead: string;
  stats: HeroStat[];
}

export interface ConsoleSlots {
  kakao: ReactNode;
  partners: ReactNode;
  link: ReactNode;
  settings: ReactNode;
}

export function ConsoleShell({
  slots,
  hero,
  brandName,
  brandMark,
  brandSub,
  userName,
  badges,
  isAdmin = false,
  initialView = 'kakao',
  signOutAction,
}: {
  slots: ConsoleSlots;
  hero: Record<ViewKey, HeroDef>;
  brandName: string;
  brandMark: string;
  brandSub: string;
  userName: string;
  badges?: { kakao?: number; link?: number };
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

  function badgeOf(key: ViewKey): number {
    if (key === 'kakao') return unhandled;
    if (key === 'link') return badges?.link ?? 0;
    return 0;
  }

  const h = hero[view];

  return (
    <div className="tss">
      <header className="nav">
        <div className="nav-in">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              {brandMark}
            </span>
            <span className="brand-name">{brandName}</span>
          </div>

          <nav className="tabs" role="tablist" aria-label="주요 메뉴">
            {navItems.map((n) => {
              const badge = badgeOf(n.key);
              return (
                <button
                  key={n.key}
                  type="button"
                  role="tab"
                  aria-selected={view === n.key}
                  className="tab"
                  onClick={() => {
                    setView(n.key);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  {n.label}
                  {badge > 0 ? <span className="count">{badge}</span> : null}
                </button>
              );
            })}
          </nav>

          <div className="nav-right">
            <span className="pill">{brandSub}</span>
            <span className="avatar" title={userName}>
              {avatar}
            </span>
            <button
              type="button"
              className="iconbtn"
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11l3-3-3-3M13.5 8H6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-in">
          <div className="hero-top">
            <div>
              <span className="eyebrow">{h.eyebrow}</span>
              <h1>{h.title}</h1>
              <p className="lead">{h.lead}</p>
            </div>
          </div>
          <div className="stats">
            {h.stats.map((s) => (
              <div key={s.k} className={`stat${s.alert ? ' alert' : ''}`}>
                <div className="k">{s.k}</div>
                <div className="v">
                  {s.live === 'unhandled' ? String(unhandled) : s.v}
                  {s.unit ? <small>{s.unit}</small> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="wrap">
        {navItems.map((n) => (
          <section key={n.key} className={`view${view === n.key ? ' on' : ''}`} role="tabpanel" id={`v-${n.key}`}>
            {visited.includes(n.key) ? (
              <TabActiveProvider value={view === n.key}>
                <KakaoAlertsProvider value={alerts}>{slots[n.key]}</KakaoAlertsProvider>
              </TabActiveProvider>
            ) : null}
          </section>
        ))}
      </main>

      {/* 새 카톡 알림. 누르면 받은 카톡으로 간다 — 방금 온 방이 목록 맨 위에 있다. */}
      {toast ? (
        <button
          key={toast.seq}
          type="button"
          className="toast"
          onClick={() => {
            setView('kakao');
            setToast(null);
          }}
        >
          <span className="tx">
            <b>{toast.title}</b> {toast.body}
          </span>
        </button>
      ) : null}
    </div>
  );
}
