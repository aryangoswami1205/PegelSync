# PegelSync: Serverless Hydrological Flood Risk Alert System 🌊

**PegelSync** is a zero-dependency, cloud-native microservice and dashboard that monitors real-time river gauge data across Germany's 5 major river basins and generates automated flood risk alerts.

Built to replace expensive 24/7 server-based monitoring, this project leverages AWS Serverless technologies to achieve a highly scalable, fault-tolerant system that costs **$0.00/month** to run under the AWS Free Tier.

## 🖥️ Live Dashboard

- **v1 (Vanilla JS + Leaflet):** https://aryangoswami1205.github.io/PegelSync/
- **v2 (React + MapLibre, in progress):** built from `frontend-v2/`, deployed to the same GitHub Pages site.

## 🌟 Key Features

### Backend (AWS Lambda)
- **Zero third-party dependencies**: the Lambda uses ONLY Python standard libraries plus `boto3` (pre-installed in the AWS runtime). No pip packages at runtime.
- **Multi-file deploy as a ZIP**: `lambda_function.py` imports `forecast` and `providers`; all three are zipped and uploaded via the console (inline paste breaks the cross-file imports).
- **Statistically-validated forecast engine** (`forecast.py`): a rolling-origin backtest against persistence, with 90% empirical prediction intervals and an explicit skill gate — so untrustworthy forecasts are flagged rather than over-claimed. Not a black box.
- **15-Station National Network**: monitors gauges across 5 major basins — Rhine, Danube, Elbe, Weser, and Oder — with URL-encoded API calls for safe handling of German umlauts (Ö, Ü).
- **Fault-Tolerant Execution**: per-station `try/except` isolation — if one station goes offline, the other 14 continue to process.
- **Tuned for speed**: per-host connection caps + bounded worker pool + **512 MB Lambda memory** (AWS grants CPU proportional to memory) bring a full 15-station / 3-API run to **~7s** (was ~22s at 128 MB).
- **Automated Scheduling**: triggered (default hourly) via AWS EventBridge.

### Frontend
- **v1 — Split-Pane Spatial Workspace**: desktop layout with a dominant Leaflet.js WebGIS map and a high-density telemetry matrix — no generic card grids.
  - Light / Dark theme with smooth transitions and `localStorage` persistence.
  - Bidirectional cross-highlighting between map markers and matrix rows.
  - Client-side CSV export via the `Blob` API.
  - Fully responsive with fluid breakpoints (1024 / 700 / 420px).
- **v2 — React + MapLibre rewrite** (`frontend-v2/`): TypeScript, Next.js static export, MapLibre GL map, KPI strip, telemetry matrix, theme provider. No Deck.gl, no basin polygons, no heatmap (per-station precipitation is fine).

## 🏗️ Architecture

```
EventBridge (hourly) → AWS Lambda (lambda_function.py)
                          │  ├─ PEGELONLINE REST API (v2)   → water level + discharge (Q)
                          │  ├─ api.brightsky.dev           → precipitation forecast
                          │  └─ forecast.py / providers.py  → local 48h-ahead level forecast + 90% PIs
                          ↓
                     Amazon S3 (latest_status.json + alert batches)
                          ↓
              GitHub Pages Dashboard (Leaflet.js v1 / React+MapLibre v2)
```

1. **AWS EventBridge** triggers the Lambda function on schedule.
2. **AWS Lambda** iterates over 15 monitored stations, URL-encoding each station name, and fetches water level, discharge, and precipitation in parallel (per-host concurrency capped to avoid upstream throttling).
3. The **forecast engine** (`forecast.py`) produces a backtest-validated level prediction with 90% prediction intervals per station.
4. If a station's water level exceeds its defined threshold, an alert payload is written to S3.
5. **Amazon S3** stores a continuously updated `latest_status.json`.
6. The **Frontend Dashboard** (GitHub Pages) fetches `latest_status.json` and renders the interactive map, telemetry matrix, and KPI indicators.

### Forecast source note (EFAS)
The original goal was to use the EFAS / NHW calibrated hydrological forecast as the primary source. The anonymous EFAS REST API (`efas.forest.jrc.ec.europa.eu`) is **now decommissioned** — it fails DNS resolution even from AWS Lambda. Adopting EFAS today would require a Copernicus CDS account + API key + the `cdsapi` dependency + grid interpolation, which conflicts with the zero-dependency, paste-in Lambda design. The local statistical model (`forecast.py`) is therefore the **primary and only** forecast source; `forecast_source` is recorded per station so a future authoritative feed can be slotted in without touching the Lambda or either UI.

## 📡 Monitored Stations (15)

| # | Station ID | Label | River | Basin | Threshold |
|---|-----------|-------|-------|-------|-----------|
| 1 | KÖLN | Cologne | Rhine | Rhine | 6.20 m |
| 2 | MAXAU | Maxau | Rhine | Rhine | 7.00 m |
| 3 | COCHEM | Cochem | Moselle | Rhine | 6.20 m |
| 4 | KAUB | Kaub | Rhine | Rhine | 4.60 m |
| 5 | WÜRZBURG | Würzburg | Main | Rhine | 4.00 m |
| 6 | HEIDELBERG UP | Heidelberg | Neckar | Rhine | 4.40 m |
| 7 | PASSAU DONAU | Passau | Danube | Danube | 7.00 m |
| 8 | PFELLING | Straubing | Danube | Danube | 4.50 m |
| 9 | DRESDEN | Dresden | Elbe | Elbe | 4.00 m |
| 10 | MAGDEBURG-STROMBRÜCKE | Magdeburg | Elbe | Elbe | 4.30 m |
| 11 | SCHÖNA | Schöna | Elbe | Elbe | 4.00 m |
| 12 | VEGESACK | Bremen | Weser | Weser | 8.90 m |
| 13 | HANN.MUENDEN | Hann. Münden | Weser | Weser | 4.00 m |
| 14 | HAMBURG ST. PAULI | Hamburg | Elbe | Elbe Estuary | 8.70 m |
| 15 | FRANKFURT1 (ODER) | Frankfurt/Oder | Oder | Oder | 4.00 m |

## 📂 Repository Structure

```
PegelSync/
├── lambda_function.py          # AWS Lambda backend (15-station network + alerting)
├── forecast.py                 # Statistically-validated level forecast engine
├── providers.py                # Forecast source dispatch (local primary; EFAS-ready)
├── lambda_deploy.zip           # Build artifact: zip of the 3 .py files for upload (gitignored)
├── assets/                     # Brand marks (SVG + PNG)
├── frontend-dashboard/         # v1 dashboard (Leaflet + Vanilla JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── frontend-v2/                # v2 dashboard (React + MapLibre, Next.js static export)
│   ├── src/
│   ├── public/
│   └── package.json
├── Dockerfile                  # Local Lambda testing container
├── requirements.txt            # boto3 for local testing (pre-installed on AWS)
└── README.md
```

## 🚀 Quick Start & Deployment

### Local Testing
```bash
# Test the Lambda logic locally in a Docker container
docker build -t pegelsync .
docker run --rm pegelsync
```

### Backend Deployment (AWS Lambda)
The Lambda is **multi-file**, so it must be deployed as a ZIP (not pasted inline):

1. Build the artifact (already provided as `lambda_deploy.zip`, or regenerate):
   ```bash
   zip -q lambda_deploy.zip lambda_function.py forecast.py providers.py
   ```
2. AWS Console → Lambda → **Code** → **Upload from .zip file** → select `lambda_deploy.zip`.
3. **Configuration → General configuration**: set **Memory = 512 MB** (CPU scales with memory; 128 MB starves the threaded fetch loop). Handler stays `lambda_function.lambda_handler`.
4. **Configuration → Environment variables**:
   - `ALERT_BUCKET_NAME` = your S3 bucket (e.g. `aryan-hydro-alerts-882611-2026`).
   - `PERF_DIAG` = `1` (optional) to surface per-fetch timings in the Test response while tuning.

### Frontend Preview
```bash
# v1
cd frontend-dashboard && python3 -m http.server 8080
# v2
cd frontend-v2 && npm install && npm run dev
```

### Frontend Deployment
The `frontend-dashboard/` (and `frontend-v2/` output) are deployed to the `gh-pages` branch and served via GitHub Pages.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Cloud Infrastructure** | AWS Lambda, Amazon S3, AWS EventBridge, AWS IAM |
| **Backend** | Python 3 (Standard Library only + boto3) |
| **Forecast** | Local rolling-origin backtest, 90% empirical PIs (stdlib) |
| **Frontend v1** | HTML5, CSS3, Vanilla JavaScript, Leaflet.js 1.9.4 |
| **Frontend v2** | React, TypeScript, Next.js (static export), MapLibre GL |
| **WebGIS** | Leaflet.js (v1) / MapLibre GL (v2) with CartoDB tile layers |
| **Data Sources** | PEGELONLINE REST API (v2), api.brightsky.dev (precipitation) |
| **Hosting** | GitHub Pages |

## 👤 Author

Built by **Aryan Goswami**
