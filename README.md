# SerHydroSys: Serverless Hydrological Flood Risk Alert System 🌊

**SerHydroSys** is a zero-dependency, cloud-native microservice and dashboard that monitors real-time river gauge data across Germany's 5 major river basins and generates automated flood risk alerts.

Built to replace expensive 24/7 server-based monitoring, this project leverages AWS Serverless technologies to achieve a highly scalable, fault-tolerant system that costs $0.00/month to run under the AWS Free Tier.

## 🖥️ Live Dashboard

**[View the Live Dashboard →](https://aryangoswami1205.github.io/SerFloodSys/)**

## 🌟 Key Features

### Backend
- **Zero-Dependency Lambda**: Built using purely Python standard libraries (`urllib`, `json`, `urllib.parse`). No pip packages, no deployment ZIP, minimal cold-start.
- **15-Station National Network**: Monitors gauges across 5 major basins — Rhine, Danube, Elbe, Weser, and Oder — with URL-encoded API calls for safe handling of German umlauts (Ö, Ü) and special characters.
- **Fault-Tolerant Execution**: Per-station `try/except` isolation — if one station goes offline, the other 14 continue to process.
- **Automated Scheduling**: Triggered hourly via AWS EventBridge.

### Frontend
- **Split-Pane Spatial Workspace**: Desktop layout with a dominant Leaflet.js WebGIS map and a high-density telemetry data matrix — no generic card grids.
- **Light / Dark Theme**: Smooth `0.4s` cubic-bezier transitions with `localStorage` persistence. Map tile layers swap dynamically between CartoDB Positron (light) and Dark Matter (dark).
- **Bidirectional Cross-Highlighting**: Hover a map marker → the matching matrix row highlights and siblings dim. Hover a matrix row → the corresponding map marker enlarges and opens its popup.
- **Client-Side CSV Export**: One-click report download using the `Blob` API — zero backend required.
- **Reset View Control**: Custom Leaflet control button to instantly restore the optimal map zoom showing all stations.
- **Fully Responsive**: Fluid breakpoints at 1024px (tablet), 700px (mobile), and 420px (small mobile). Map pins to the top on mobile with the matrix scrolling below.

## 🏗️ Architecture

```
EventBridge (hourly) → AWS Lambda → PEGELONLINE REST API (v2)
                          ↓
                     Amazon S3 (latest_status.json + alert batches)
                          ↓
              GitHub Pages Dashboard (Leaflet.js + Vanilla JS)
```

1. **AWS EventBridge** triggers the Lambda function every hour.
2. **AWS Lambda** iterates over 15 monitored stations, URL-encoding each station name before calling the PEGELONLINE API.
3. If a station's water level exceeds its defined threshold, an alert payload is appended to a batch.
4. **Amazon S3** stores timestamped alert batches and a continuously updated `latest_status.json`.
5. The **Frontend Dashboard** (GitHub Pages) fetches `latest_status.json` via CORS and renders the interactive map, telemetry matrix, and KPI indicators.

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
SerHydroSys/
├── lambda_function.py          # AWS Lambda backend (15-station network)
├── frontend-dashboard/
│   ├── index.html              # Split-pane spatial layout + theme toggle
│   ├── styles.css              # CSS design system with light/dark tokens
│   └── app.js                  # Leaflet map, matrix rendering, cross-highlighting, CSV export
├── Dockerfile                  # Local Lambda testing container
├── requirements.txt            # boto3 for local testing (pre-installed on AWS)
└── README.md
```

## 🚀 Quick Start & Deployment

### Local Testing
```bash
# Test the Lambda logic locally in a Docker container
docker build -t serhydrosys .
docker run --rm serhydrosys
```

### Frontend Preview
```bash
# Serve the dashboard locally
cd frontend-dashboard
python3 -m http.server 8080
# Open http://localhost:8080
```

### Production Deployment
- **Backend**: Deploy `lambda_function.py` to AWS Lambda via the console.
- **Frontend**: The `frontend-dashboard/` directory is deployed to the `gh-pages` branch and served via GitHub Pages.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Cloud Infrastructure** | AWS Lambda, Amazon S3, AWS EventBridge, AWS IAM |
| **Backend** | Python 3.14 (Standard Library only) |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **WebGIS** | Leaflet.js 1.9.4 with CartoDB tile layers |
| **Typography** | Inter (UI) + JetBrains Mono (data) |
| **Containerization** | Docker |
| **Data Source** | PEGELONLINE REST API (v2) |
| **Hosting** | GitHub Pages |

## 👤 Author

Built by **Aryan Goswami**
