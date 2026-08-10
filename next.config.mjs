import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  // 상위 폴더(Speciai)에도 lockfile 이 있어 Next 가 워크스페이스 루트를 잘못 잡는다.
  // 이 앱은 모노레포가 아니므로 자기 폴더로 고정한다.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
