import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/PegelSync',
  images: { unoptimized: true },
};

export default nextConfig;
