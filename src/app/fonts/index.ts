// 폰트 self-host — CDN @import 제거, next/font 로 전환.
// --sans: Pretendard 가변(로컬 woff2). --serif: 경위서 정본용(함초롬바탕→Noto Serif KR 폴백).
import localFont from 'next/font/local';
import { Noto_Serif_KR } from 'next/font/google';

export const pretendard = localFont({
  src: './PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920', // 가변 축 범위
  variable: '--font-sans',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Apple SD Gothic Neo', 'Malgun Gothic', 'sans-serif'],
});

// 경위서 A4 정본. 사용자 PC에 함초롬바탕 있으면 그걸 쓰고, 없으면 이 웹폰트로 폴백.
export const notoSerifKr = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-serif',
});
