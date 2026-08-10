import type { ReactNode } from 'react';
import { pretendard, notoSerifKr } from './fonts';
import '@/lib/ui/globals.css';
import './app.css';
import '@/lib/ui/console-v2.css';

export const metadata = {
  title: `${process.env.NEXT_PUBLIC_BRAND_NAME ?? '카톡 통합함'}`,
  description: '거래처 카카오톡 단톡방 통합 수집·정리',
};

// 431 Request Header Fields Too Large 자가 복구 스크립트.
// 같은 이름의 sb-*-auth-token chunk 쿠키가 중복 누적되면 헤더가 한도를 넘는다.
// 12KB 초과 시 stale sb-* 쿠키를 비우고 sign-in 으로 보낸다.
// 정상 로그인 토큰 1세트는 6~8KB 범위라 임계치 12KB는 충분히 안전.
const COOKIE_GUARD = `
(function(){
  try {
    var raw = document.cookie || '';
    if (raw.length <= 12288) return;
    var names = raw.split(';').map(function(s){return s.trim().split('=')[0];});
    var hosts = [location.hostname, '.' + location.hostname];
    names.forEach(function(n){
      if (/^sb-.*-auth-token(\\.\\d+)?$/.test(n)) {
        hosts.forEach(function(h){
          document.cookie = n + '=; path=/; max-age=0; domain=' + h;
        });
        document.cookie = n + '=; path=/; max-age=0';
      }
    });
    if ((document.cookie || '').length < raw.length) {
      location.replace('/auth/sign-in');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${notoSerifKr.variable}`}>
      <head>
        {/* 브라우저가 옛 HTML(404된 CSS 해시를 가리키는)을 캐시하지 못하게 한다. */}
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <script dangerouslySetInnerHTML={{ __html: COOKIE_GUARD }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
