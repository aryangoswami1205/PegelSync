import type { NextConfig } from "next";

// basePath is env-driven so the same build can target:
//   - the production site at github.io/PegelSync/  (default: BASE_PATH=/PegelSync)
//   - a standalone preview at the repo root         (BASE_PATH="" when deploying to a dedicated repo)
const basePath = process.env.BASE_PATH ?? "/PegelSync";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
