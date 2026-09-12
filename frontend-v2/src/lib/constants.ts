export const S3_STATUS_URL =
  "https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json";
export const LOCAL_STATUS_URL = "/sample_status.json";
export const REFRESH_INTERVAL_MS = 300_000;

// Must match `basePath` in next.config.ts. Used for static assets
// (the SVG brand mark) so they resolve under the GitHub Pages subpath.
// Defaults to /PegelSync for the production site; set to "" when deploying
// the app as a standalone site at a repo root.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/PegelSync";

// OpenFreeMap vector styles — free, no API key, zero watermarks, retina-crisp rendering
export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const TILE_URLS = MAP_STYLES;

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

