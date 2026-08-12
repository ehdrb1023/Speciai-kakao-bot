'use client';

// 거래처 카톡 통합 콘솔 SPA 셸. 상단 헤더 + 가로 네비(탭) 구조.
// 세션·워크스페이스 가드는 상위 layout(서버)이 처리.

import { useEffect, useState, type ReactNode } from 'react';
import { IconDefs, Ic } from './IconDefs';
import { CV2_NAV_EVENT, type Cv2NavDetail } from './nav';

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
  const [signingOut, setSigningOut] = useState(false);
  const avatar = userName.charAt(0) || '·';
  const navItems = NAV.filter((n) => !n.adminOnly || isAdmin);

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
              const badge = n.key === 'kakao' ? badges?.kakao : undefined;
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
              {view === n.key ? slots[n.key] : null}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
