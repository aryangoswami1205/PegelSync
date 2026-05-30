/**
 * SerHydroSys — Dashboard App
 * ============================
 * Fetches `latest_status.json` from the public S3 bucket and renders
 * live station cards with water-level gauges, status badges, a
 * summary bar, an interactive Leaflet map with cross-highlighting,
 * and a client-side CSV report export.
 */

// ── Configuration ──────────────────────────────────────────────────
// Replace this URL with your actual S3 bucket's public URL.
// The bucket must have CORS configured to allow your dashboard's
// origin to make GET requests (see AWS_DEPLOYMENT_GUIDE.md).
const S3_STATUS_URL =
  "https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json";
// LOCAL DEV: Uncomment the line below to use the local mock file.
// const S3_STATUS_URL = "latest_status.json";

// How often to auto-refresh the data (in milliseconds).
// 5 minutes = 300 000 ms — matches the Lambda's hourly schedule
// but keeps the dashboard feeling responsive.
const REFRESH_INTERVAL_MS = 300_000;

// ── DOM References ─────────────────────────────────────────────────
const cardsContainer = document.getElementById("station-cards");
const loadingState = document.getElementById("loading-state");
const summaryStations = document.getElementById("summary-stations");
const summaryAlerts = document.getElementById("summary-alerts");
const summaryUpdated = document.getElementById("summary-updated");
const connectionIndicator = document.getElementById("connection-indicator");
const exportBtn = document.getElementById("export-report-btn");

// ── Map State ──────────────────────────────────────────────────────
let map = null;
const markerRegistry = {}; // station_id → { marker, popup }

// ── Cached Data (for export) ───────────────────────────────────────
let lastFetchedData = null;

// ── Initialise the Leaflet Map ─────────────────────────────────────
function initMap() {
  map = L.map("station-map", {
    center: [51.0, 10.5], // Approximate centre of Germany
    zoom: 6,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
  });

  // CartoDB Dark Matter — clean dark-mode tile layer
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);
}

// ── Main Fetch Function ────────────────────────────────────────────
async function fetchStationData() {
  setConnectionStatus("loading");

  try {
    const response = await fetch(S3_STATUS_URL, { cache: "no-cache" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    lastFetchedData = data;
    renderDashboard(data);
    renderMapMarkers(data.stations || []);
    setConnectionStatus("live");
  } catch (error) {
    console.error("Failed to fetch station data:", error);
    setConnectionStatus("error");

    if (loadingState) {
      loadingState.innerHTML = `
        <p style="color: var(--accent-alert);">
          ⚠️ Unable to load station data.
        </p>
        <p style="color: var(--text-muted); font-size: 0.85rem;">
          Check that the S3 bucket is public and CORS is configured.<br>
          <code>${S3_STATUS_URL}</code>
        </p>
      `;
    }
  }
}

// ── Render Dashboard ───────────────────────────────────────────────
function renderDashboard(data) {
  const stations = data.stations || [];
  const generatedAt = data.generated_at;

  // Update the summary bar.
  summaryStations.textContent = stations.length;
  summaryAlerts.textContent = stations.filter(s => s.status === "ALERT").length;
  summaryUpdated.textContent = formatTimestamp(generatedAt);

  // Highlight alert count in red if any alerts exist.
  const alertCount = stations.filter(s => s.status === "ALERT").length;
  summaryAlerts.style.color = alertCount > 0
    ? "var(--accent-alert)"
    : "var(--accent-safe)";

  // Clear the cards container (removes loading spinner on first load).
  cardsContainer.innerHTML = "";

  // Generate a card for each station.
  stations.forEach(station => {
    const card = createStationCard(station);
    cardsContainer.appendChild(card);
  });
}

// ── Create Station Card ────────────────────────────────────────────
function createStationCard(station) {
  const card = document.createElement("article");
  card.className = "station-card";
  card.dataset.stationId = station.station_id;

  const statusLower = (station.status || "safe").toLowerCase();

  // Add status-specific class.
  if (statusLower === "alert") {
    card.classList.add("station-card--alert", "card--alert");
  } else if (statusLower === "error") {
    card.classList.add("station-card--error", "card--error");
  } else {
    card.classList.add("card--safe");
  }

  const level = station.water_level_m;
  const threshold = station.threshold_m;
  const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;
  const fillClass = pct >= 100 ? "threshold-fill--alert" : "";

  const levelDisplay = level != null ? level.toFixed(2) : "—";

  const timeDisplay = station.measurement_timestamp
    ? formatTimestamp(station.measurement_timestamp)
    : "N/A";

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${station.label}</div>
        <div class="card-station-id">${station.station_id}</div>
      </div>
      <span class="status-badge status-badge--${statusLower}">
        ${statusLower === "alert" ? "⚠ Alert" : statusLower === "error" ? "✕ Error" : "● Safe"}
      </span>
    </div>
    <div class="water-level-display">
      <span class="water-value">${levelDisplay}</span>
      <span class="water-unit">metres</span>
    </div>
    <div class="threshold-bar">
      <div class="threshold-fill ${fillClass}" style="width: ${pct}%"></div>
    </div>
    <div class="card-meta">
      <span class="meta-item"><strong>Threshold:</strong> ${threshold.toFixed(2)} m</span>
      <span class="meta-item"><strong>Updated:</strong> ${timeDisplay}</span>
    </div>
  `;

  // ── Cross-highlighting: Card → Map ───────────────────────────────
  card.addEventListener("mouseenter", () => {
    const entry = markerRegistry[station.station_id];
    if (entry) {
      entry.popup.openOn(map);
      entry.marker.setStyle({ weight: 4, fillOpacity: 1 });
    }
  });

  card.addEventListener("mouseleave", () => {
    const entry = markerRegistry[station.station_id];
    if (entry) {
      map.closePopup();
      entry.marker.setStyle({ weight: 2, fillOpacity: 0.85 });
    }
  });

  return card;
}

// ── Render Map Markers ─────────────────────────────────────────────
function renderMapMarkers(stations) {
  // Clear previous markers
  Object.values(markerRegistry).forEach(({ marker }) => {
    map.removeLayer(marker);
  });
  for (const key of Object.keys(markerRegistry)) {
    delete markerRegistry[key];
  }

  const bounds = [];

  stations.forEach(station => {
    const lat = station.lat;
    const lon = station.lon;
    if (lat == null || lon == null) return;

    const isAlert = station.status === "ALERT";
    const isError = station.status === "ERROR";

    const markerColor = isAlert
      ? "#f87171"
      : isError
        ? "#fbbf24"
        : "#22d3ee";

    const marker = L.circleMarker([lat, lon], {
      radius: isAlert ? 10 : 8,
      fillColor: markerColor,
      color: markerColor,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85,
      className: isAlert ? "leaflet-marker--alert" : "",
    }).addTo(map);

    // Popup content
    const levelStr =
      station.water_level_m != null
        ? station.water_level_m.toFixed(2) + " m"
        : "N/A";

    const statusClass = isAlert ? "alert" : "safe";

    const popup = L.popup({ closeButton: false, offset: [0, -6] }).setContent(`
      <div class="popup-title">${station.label}</div>
      <div class="popup-level ${statusClass}">${levelStr}</div>
      <div class="popup-meta">Threshold: ${station.threshold_m.toFixed(2)} m · ${station.status}</div>
    `);

    marker.bindPopup(popup);

    // ── Cross-highlighting: Map → Card ─────────────────────────────
    marker.on("mouseover", () => {
      marker.openPopup();
      marker.setStyle({ weight: 4, fillOpacity: 1 });
      highlightCard(station.station_id, true);
    });

    marker.on("mouseout", () => {
      marker.closePopup();
      marker.setStyle({ weight: 2, fillOpacity: 0.85 });
      highlightCard(station.station_id, false);
    });

    markerRegistry[station.station_id] = { marker, popup };
    bounds.push([lat, lon]);
  });

  // Fit map to show all markers with padding
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
  }
}

// ── Cross-Highlight Helpers ────────────────────────────────────────

/** Add or remove the glow highlight class on a station card. */
function highlightCard(stationId, active) {
  const card = cardsContainer.querySelector(
    `[data-station-id="${stationId}"]`
  );
  if (!card) return;

  if (active) {
    card.classList.add("station-card--highlight");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    card.classList.remove("station-card--highlight");
  }
}

// ── Export Report ──────────────────────────────────────────────────

/**
 * Generate a CSV report from the current station data and trigger
 * a browser download using the Blob API. No backend required.
 */
function exportReport() {
  if (!lastFetchedData || !lastFetchedData.stations) {
    alert("No station data available yet. Please wait for data to load.");
    return;
  }

  const stations = lastFetchedData.stations;
  const generatedAt = lastFetchedData.generated_at || new Date().toISOString();

  // CSV header
  const headers = [
    "Report Timestamp",
    "Station",
    "Station ID",
    "River",
    "Latitude",
    "Longitude",
    "Current Level (m)",
    "Threshold (m)",
    "Level %",
    "Status",
    "Measurement Timestamp",
  ];

  // CSV rows
  const rows = stations.map(s => {
    // Extract the river name from the label, e.g. "Cologne (Rhine)" → "Rhine"
    const riverMatch = s.label.match(/\(([^)]+)\)/);
    const river = riverMatch ? riverMatch[1] : "—";

    const level = s.water_level_m != null ? s.water_level_m.toFixed(2) : "N/A";
    const threshold = s.threshold_m.toFixed(2);
    const pct =
      s.water_level_m != null
        ? ((s.water_level_m / s.threshold_m) * 100).toFixed(1) + "%"
        : "N/A";

    return [
      generatedAt,
      `"${s.label}"`,
      s.station_id,
      river,
      s.lat ?? "",
      s.lon ?? "",
      level,
      threshold,
      pct,
      s.status,
      s.measurement_timestamp || "N/A",
    ].join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");

  // Create and trigger download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  const dateSlug = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  link.href = url;
  link.download = `SerHydroSys_Report_${dateSlug}.csv`;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Format an ISO timestamp into a short, human-friendly string in German time. */
function formatTimestamp(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-GB", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString || "—";
  }
}

/** Update the connection indicator in the header. */
function setConnectionStatus(status) {
  // Remove existing status classes.
  connectionIndicator.classList.remove(
    "indicator--loading",
    "indicator--live",
    "indicator--error"
  );

  const dot = connectionIndicator.querySelector(".indicator-dot");
  const label = connectionIndicator.querySelector(".indicator-label");

  switch (status) {
    case "loading":
      connectionIndicator.classList.add("indicator--loading");
      label.textContent = "Refreshing…";
      break;
    case "live":
      connectionIndicator.classList.add("indicator--live");
      label.textContent = "Live";
      break;
    case "error":
      connectionIndicator.classList.add("indicator--error");
      label.textContent = "Offline";
      break;
  }
}

// ── Initialise ─────────────────────────────────────────────────────

// Initialise the Leaflet map.
initMap();

// Wire up the Export Report button.
exportBtn.addEventListener("click", exportReport);

// Fetch data immediately on page load.
fetchStationData();

// Set up auto-refresh on an interval.
setInterval(fetchStationData, REFRESH_INTERVAL_MS);
