export const S3_STATUS_URL =
  "https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json";
export const REFRESH_INTERVAL_MS = 300_000;

export const TILE_URLS = {
  light: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  dark: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
};

export const TILE_OPTIONS = {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
};
