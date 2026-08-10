import { notFound } from 'next/navigation';
import { PreviewConsole } from './PreviewConsole';

export const metadata = { title: '미리보기 · 카톡 통합함' };

// 목업 데이터로 도는 UI 확인 화면. Supabase·로그인 없이 열린다.
//
// 기본은 개발 환경 전용이다. 실서비스에 열어두면 실데이터인 줄 알고 보는 사람이 생긴다.
// Vercel 프리뷰 배포에서 보려면 NEXT_PUBLIC_ENABLE_PREVIEW=1 을 그 환경에만 넣는다.
export default function Page() {
  const enabled =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_PREVIEW === '1';
  if (!enabled) notFound();
  return <PreviewConsole />;
}
