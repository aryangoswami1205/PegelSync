/**
 * SerHydroSys — Dashboard App
 * Fetches latest_status.json from S3 and renders live station cards.
 */
const S3_STATUS_URL =
  "https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json";
const REFRESH_INTERVAL_MS = 300_000;

const cardsContainer = document.getElementById("station-cards");
const loadingState = document.getElementById("loading-state");
const summaryStations = document.getElementById("summary-stations");
const summaryAlerts = document.getElementById("summary-alerts");
const summaryUpdated = document.getElementById("summary-updated");
const connectionIndicator = document.getElementById("connection-indicator");

async function fetchStationData() {
  setConnectionStatus("loading");
  try {
    const response = await fetch(S3_STATUS_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    renderDashboard(data);
    setConnectionStatus("live");
  } catch (error) {
    console.error("Failed to fetch station data:", error);
    setConnectionStatus("error");
    if (loadingState) {
      loadingState.innerHTML = `<p style="color: var(--accent-alert)">⚠️ Unable to load station data.</p><p style="color: var(--text-muted); font-size: 0.85rem">Check that the S3 bucket is public and CORS is configured.<br><code>${S3_STATUS_URL}</code></p>`;
    }
  }
}

function renderDashboard(data) {
  const stations = data.stations || [];
  const alertCount = stations.filter(s => s.status === "ALERT").length;
  summaryStations.textContent = stations.length;
  summaryAlerts.textContent = alertCount;
  summaryUpdated.textContent = formatTimestamp(data.generated_at);
  summaryAlerts.style.color = alertCount > 0 ? "var(--accent-alert)" : "var(--accent-safe)";
  cardsContainer.innerHTML = "";
  stations.forEach(station => cardsContainer.appendChild(createStationCard(station)));
}

function createStationCard(station) {
  const card = document.createElement("article");
  card.className = "station-card";
  const statusLower = (station.status || "safe").toLowerCase();
  if (statusLower === "alert") card.classList.add("station-card--alert", "card--alert");
  else if (statusLower === "error") card.classList.add("station-card--error", "card--error");
  else card.classList.add("card--safe");
  const level = station.water_level_m;
  const threshold = station.threshold_m;
  const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;
  const fillClass = pct >= 100 ? "threshold-fill--alert" : "";
  const levelDisplay = level != null ? level.toFixed(2) : "—";
  const timeDisplay = station.measurement_timestamp ? formatTimestamp(station.measurement_timestamp) : "N/A";
  card.innerHTML = `<div class="card-header"><div><div class="card-title">${station.label}</div><div class="card-station-id">${station.station_id}</div></div><span class="status-badge status-badge--${statusLower}">${statusLower === "alert" ? "⚠ Alert" : statusLower === "error" ? "✕ Error" : "● Safe"}</span></div><div class="water-level-display"><span class="water-value">${levelDisplay}</span><span class="water-unit">metres</span></div><div class="threshold-bar"><div class="threshold-fill ${fillClass}" style="width: ${pct}%"></div></div><div class="card-meta"><span class="meta-item"><strong>Threshold:</strong> ${threshold.toFixed(2)} m</span><span class="meta-item"><strong>Updated:</strong> ${timeDisplay}</span></div>`;
  return card;
}

function formatTimestamp(isoString) {
  try { return new Date(isoString).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }); }
  catch { return isoString || "—"; }
}

function setConnectionStatus(status) {
  connectionIndicator.classList.remove("indicator--loading", "indicator--live", "indicator--error");
  const label = connectionIndicator.querySelector(".indicator-label");
  switch (status) {
    case "loading": connectionIndicator.classList.add("indicator--loading"); label.textContent = "Refreshing…"; break;
    case "live": connectionIndicator.classList.add("indicator--live"); label.textContent = "Live"; break;
    case "error": connectionIndicator.classList.add("indicator--error"); label.textContent = "Offline"; break;
  }
}

fetchStationData();
setInterval(fetchStationData, REFRESH_INTERVAL_MS);
