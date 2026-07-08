import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  output: 'standalone',
  basePath: '/v3',
  assetPrefix: '/v3',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  generateBuildId: () => `build-${Date.now()}`,
  env: {
    NEXT_PUBLIC_BASE_PATH: '/v3',
  },
};

export default nextConfig;
