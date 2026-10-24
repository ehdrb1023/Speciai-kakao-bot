import type { MetadataRoute } from 'next';

// 운영 경로는 Disallow 에 적지 않는다 — robots 에 적으면 "거기 뭔가 있다"를 스스로
// 광고하는 꼴이다. 대신 실제로 없는 미끼 두 개를 넣는다. 어디에서도 링크되지 않으므로
// 정상 크롤러는 지나가고, robots 를 읽고 굳이 찾아 들어오는 쪽만 미들웨어 함정에 걸린다.
const DISALLOW = ['/api/', '/internal-backup-2019/', '/_staff-tools/'];

function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || 'https://linktalk.speciai.kr';
  return raw.replace(/\/$/, '');
}

export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: DISALLOW }],
    host: site,
  };
}
