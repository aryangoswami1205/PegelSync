# PegelSync Frontend & Forecasting Roadmap

## Phase 4 (DONE): Dashboard rewrite — Next.js + MapLibre

Migrate the PegelSync frontend from Vanilla JS + Leaflet to a **Next.js (App
Router)** application using **react-map-gl + MapLibre GL JS** for the map.
This is a clean React/TypeScript rewrite that preserves every feature of the
old Leaflet dashboard, *without* the originally-proposed Deck.gl / basin-polygon
/ precipitation-heatmap overhaul (those were cut as unnecessary for this
project — per-station precipitation badges are sufficient).

### Architectural decisions

- **Basemap: MapLibre GL JS (not Mapbox).** No API key, free, BSD-3-Clause.
  Uses free CartoDB **raster** tile styles (`light_all` / `dark_all`).
- **Framework: Next.js (App Router), static export** (`output: 'export'`,
  `basePath: '/PegelSync'`) for GitHub Pages — identical hosting to before.
- **Visualization: react-map-gl/maplibre `<Marker>` + `<Popup>`**, raster tiles.
  No Deck.gl, no GeoJSON basin layers, no heatmap. Bundle stays small.

### Features preserved (1:1 port from the old dashboard)

- Light/dark theme toggle with localStorage persistence
- Bidirectional cross-highlighting (Map ↔ Matrix)
- Client-side CSV export
- Auto-refresh on 5-minute interval
- Connection status indicator (Live / Syncing / Offline)
- Reset View control
- Responsive desktop → tablet → mobile
- Phase 3 data: status, level, threshold, gauge, **trend arrow**,
  **precipitation badge** (per station, next 24h mm), **discharge (m³/s)**,
  **rate of change (cm/hr)** in the map popup.

### Data source

Single endpoint: `latest_status.json` on the public S3 bucket
(`https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json`),
consumed by both `frontend-dashboard` (v1) and `frontend-v2`. The Lambda
writes this file hourly.

### Deployment

`cd frontend-v2 && npm run build` → static output in `out/` → push to the
`gh-pages` branch (base path `/PegelSync`). A GitHub Actions workflow is
required (none exists yet — see Open Questions).

---

## Phase 5 (IN PROGRESS): Predictive engine — statistically validated forecasts

The goal is no longer just *monitoring*: PegelSync must **predict** water
levels with forecasts that are scientifically trustworthy — i.e. validated by
backtesting, with uncertainty quantified, not vibes.

### Design

**Hybrid model per station** (chosen for interpretability + trust, not a black
box):

1. **Trend / drift** from the recent window (last 6–24h mean slope) → short-horizon
   directional movement.
2. **AR(1) mean-reversion** on the detrended level: rivers oscillate around a
   baseline, so `level[t+1] ≈ μ + φ·(level[t] − μ) + drift`. This captures
   autocorrelation honestly and avoids explosive extrapolations.
3. **Precipitation forcing**: the next-24h/48h precipitation forecast (already
   fetched from Bright Sky) is added as a physically-motivated upward nudge,
   scaled by a conservative per-station coefficient.
4. **Prediction intervals**, not just point forecasts: computed from the
   model's residual standard error and the AR variance, so we report
   e.g. "level in 12h = 3.4 m [2.9, 3.9] (90% PI)".

Forecasts are produced in `forecast.py` (pure stdlib, reused by the Lambda) for
multiple horizons: **+6h, +12h, +24h, +48h**.

### Validation (the "trust" part)

A **rolling-origin backtest** walks historical PEGELONLINE series and, at each
origin, fits the model on the data *up to that point* and forecasts forward,
then compares to what actually happened. We report, per station and horizon:

- **RMSE / MAE** of the point forecast (vs persistence baseline)
- **Coverage** of the 90% prediction interval (should be ≈ 90%)
- **Sharpness** (interval width)
- **CRPS** (continuous-ranked probability score) vs climatology/persistence

Only forecasts that beat a persistence baseline *and* show ~nominal interval
coverage are shipped to the dashboard. If a station's backtest fails (e.g.
highly non-stationary alpine torrent), the UI shows "forecast unreliable" rather
than a confident-but-wrong number.

### Wiring

- `lambda_function.py` fetches a longer history window (`start=P7D`) and calls
  `forecast.py` to attach `forecast_6h/12h/24h/48h_m` plus 90% lower/upper bounds
  and a `forecast_skill` flag to each station's `latest_status.json` entry.
- The dashboards render a compact forecast readout (point + PI) in the popup and
  a `Forecast` column/arrow in the matrix.

### Dependencies

- **Zero backend deps** for the model itself (stdlib only) — keeps the Lambda
  zero-dependency.
- `forecast.py` is import-safe and unit-testable offline against cached series.

---

## Open Questions / TODO

- [ ] **GitHub Actions deploy workflow** for `frontend-v2` → `gh-pages`
      (`basePath: '/PegelSync'`). None exists; `gh-pages` currently holds only
      the old `frontend-dashboard` files.
- [ ] **Backtest dataset**: cache a few weeks of per-station history to run the
      validation offline and in CI (avoid hitting PEGELONLINE on every run).
- [ ] **Per-station precip coefficient** tuning from the backtest (start with a
      small conservative prior, fit where data allows).
- [ ] Decide whether v1 (`frontend-dashboard`) is retired once v2 is deployed, or
      kept as a fallback.
