/**
 * ═══════════════════════════════════════════════════════════════════
 * SerHydroSys — Application Logic (app.js)
 * ───────────────────────────────────────────────────────────────────
 * Responsibilities:
 *   1. Fetch `latest_status.json` from a public S3 bucket.
 *   2. Render an interactive Leaflet WebGIS map with theme-aware
 *      tile layers (Positron / Dark Matter) and circleMarker vectors.
 *   3. Populate a high-density telemetry data matrix (HTML table).
 *   4. Provide bidirectional cross-highlighting between map markers
 *      and matrix rows (Map↔Matrix synchronous interaction).
 *   5. Expose a client-side CSV export via Blob + URL.createObjectURL.
 *   6. Manage a light/dark theme toggle with localStorage persistence.
 * ═══════════════════════════════════════════════════════════════════
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Public S3 endpoint for the latest station status JSON.
 * The bucket must have CORS configured to accept GET requests
 * from the dashboard's origin (GitHub Pages or localhost).
 */
const S3_STATUS_URL =
  "https://aryan-hydro-alerts-882611-2026.s3.eu-north-1.amazonaws.com/latest_status.json";

/** Auto-refresh interval in milliseconds (5 minutes). */
const REFRESH_INTERVAL_MS = 300_000;

/** CartoDB tile layer URLs keyed by theme identifier. */
const TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};

/** Shared tile layer options. */
const TILE_OPTIONS = {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
};

/* ═══════════════════════════════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════════════════════════════ */

const DOM = {
  matrixBody: document.getElementById("matrix-body"),
  matrixLoading: document.getElementById("matrix-loading"),
  matrixTable: document.getElementById("matrix-table"),
  matrixCount: document.getElementById("matrix-count"),
  kpiStations: document.getElementById("kpi-stations"),
  kpiAlerts: document.getElementById("kpi-alerts"),
  kpiUpdated: document.getElementById("kpi-updated"),
  connectionIndicator: document.getElementById("connection-indicator"),
  exportBtn: document.getElementById("export-report-btn"),
  themeToggle: document.getElementById("theme-toggle"),
};

/* ═══════════════════════════════════════════════════════════════════
   APPLICATION STATE
   ═══════════════════════════════════════════════════════════════════ */

/** Leaflet map instance. */
let map = null;

/** Currently active tile layer (swapped on theme change). */
let tileLayer = null;

/**
 * Registry mapping station_id → { marker, popup } for O(1) lookup
 * during cross-highlighting interactions.
 */
const markerRegistry = {};

/** Most recent fetched data payload, cached for CSV export. */
let lastFetchedData = null;

/** Stored initial bounds for the reset-view control. */
let stationBounds = null;

/* ═══════════════════════════════════════════════════════════════════
   THEME SUBSYSTEM
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Resolve the current theme from `data-theme` attribute on <html>.
 * @returns {"light"|"dark"}
 */
function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

/**
 * Apply a theme to the document and update the map tile layer.
 * Persists the preference to localStorage.
 * @param {"light"|"dark"} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("serhydrosys-theme", theme);
  swapTileLayer(theme);
}

/**
 * Toggle between light and dark themes.
 */
function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
}

/**
 * Initialise theme from localStorage or system preference.
 * Called once at startup before the map is created.
 */
function initTheme() {
  const stored = localStorage.getItem("serhydrosys-theme");
  if (stored) {
    document.documentElement.setAttribute("data-theme", stored);
    return;
  }
  // Respect OS-level preference if no stored value
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute(
    "data-theme",
    prefersDark ? "dark" : "light"
  );
}

/**
 * Swap the Leaflet tile layer to match the active theme.
 * If the map hasn't been initialised yet, this is a no-op.
 * @param {"light"|"dark"} theme
 */
function swapTileLayer(theme) {
  if (!map) return;
  if (tileLayer) {
    map.removeLayer(tileLayer);
  }
  tileLayer = L.tileLayer(TILE_URLS[theme], TILE_OPTIONS).addTo(map);
}

/* ═══════════════════════════════════════════════════════════════════
   MAP INITIALISATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Create the Leaflet map instance, attach the initial tile layer,
 * and configure controls.  Called once at startup.
 */
function initMap() {
  map = L.map("station-map", {
    center: [51.0, 10.5], // Approximate geographic centre of Germany
    zoom: 6,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
  });

  // Attach the tile layer matching the current theme
  const theme = getCurrentTheme();
  tileLayer = L.tileLayer(TILE_URLS[theme], TILE_OPTIONS).addTo(map);

  // Add custom "Reset View" control
  const ResetViewControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      const container = L.DomUtil.create(
        "div",
        "leaflet-control-resetview leaflet-bar"
      );
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.title = "Reset view to show all stations";
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", "Reset map view");
      link.innerHTML = "⌂"; // house glyph
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(link, "click", function (e) {
        L.DomEvent.preventDefault(e);
        if (stationBounds) {
          map.flyToBounds(stationBounds, { padding: [50, 50], maxZoom: 7 });
        }
      });
      return container;
    },
  });
  map.addControl(new ResetViewControl());
}

/* ═══════════════════════════════════════════════════════════════════
   DATA FETCH
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Fetch `latest_status.json` from S3, parse it, and trigger
 * rendering of the matrix and map layers.
 */
async function fetchStationData() {
  setConnectionStatus("loading");

  try {
    const response = await fetch(S3_STATUS_URL, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    lastFetchedData = data;

    renderKPIs(data);
    renderMatrix(data.stations || []);
    renderMapMarkers(data.stations || []);
    setConnectionStatus("live");
  } catch (err) {
    console.error("[SerHydroSys] Fetch failed:", err);
    setConnectionStatus("error");

    // Show error in loading area
    if (DOM.matrixLoading) {
      DOM.matrixLoading.innerHTML = `
        <span style="color: var(--status-alert);">⚠ Unable to acquire telemetry feed.</span>
        <span style="font-size: 0.7rem;">Check CORS / S3 configuration.</span>
      `;
      DOM.matrixLoading.style.display = "flex";
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   KPI STRIP
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Update the KPI summary strip overlaid on the map pane.
 * @param {Object} data — full JSON payload
 */
function renderKPIs(data) {
  const stations = data.stations || [];
  const alertCount = stations.filter((s) => s.status === "ALERT").length;

  DOM.kpiStations.textContent = stations.length;
  DOM.kpiAlerts.textContent = alertCount;
  DOM.kpiAlerts.style.color =
    alertCount > 0 ? "var(--status-alert)" : "var(--accent-primary)";
  DOM.kpiUpdated.textContent = formatTimestamp(data.generated_at);
}

/* ═══════════════════════════════════════════════════════════════════
   TELEMETRY MATRIX
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Render the high-density telemetry data table.
 * Each row carries `data-station-id` for cross-highlight binding.
 * @param {Array} stations — array of station objects from S3 payload
 */
function renderMatrix(stations) {
  // Hide loading indicator
  if (DOM.matrixLoading) {
    DOM.matrixLoading.style.display = "none";
  }

  // Update count label
  DOM.matrixCount.textContent = `${stations.length} station${stations.length !== 1 ? "s" : ""}`;

  // Clear previous rows
  DOM.matrixBody.innerHTML = "";

  stations.forEach((station) => {
    const row = document.createElement("tr");
    row.dataset.stationId = station.station_id;

    const statusKey = (station.status || "SAFE").toUpperCase();
    const level = station.water_level_m;
    const threshold = station.threshold_m;
    const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;

    // Extract river name from label pattern "City (River)"
    const riverMatch = station.label.match(/\(([^)]+)\)/);
    const river = riverMatch ? riverMatch[1] : "—";

    const levelStr = level != null ? level.toFixed(2) : "—";
    const thresholdStr = threshold.toFixed(2);
    const pctStr = level != null ? pct.toFixed(0) : "—";
    const timeStr = station.measurement_timestamp
      ? formatTimestampShort(station.measurement_timestamp)
      : "—";

    // Status class
    const statusClass =
      statusKey === "ALERT"
        ? "alert"
        : statusKey === "ERROR"
          ? "error"
          : "safe";
    const numericClass = `is-${statusClass}`;

    row.innerHTML = `
      <td class="td-status">
        <span class="status-pip status-pip--${statusClass}" title="${statusKey}"></span>
      </td>
      <td>
        <div class="td-station-name">${escapeHtml(station.label)}</div>
        <div class="td-station-river">${escapeHtml(river)} · ${escapeHtml(station.station_id)}</div>
      </td>
      <td class="td-numeric ${numericClass}">${levelStr}<span style="font-size:0.65rem;color:var(--text-muted);margin-left:2px">m</span></td>
      <td class="td-threshold">${thresholdStr} m</td>
      <td>
        <div class="gauge-container">
          <div class="gauge-track">
            <div class="gauge-fill ${pct >= 100 ? "gauge-fill--alert" : ""}" style="width:${pct}%"></div>
          </div>
          <span class="gauge-pct">${pctStr}%</span>
        </div>
      </td>
      <td class="td-time">${timeStr}</td>
    `;

    // ── Matrix → Map cross-highlight ───────────────────────────────
    row.addEventListener("mouseenter", () => {
      // Activate row
      row.classList.add("row--active");
      DOM.matrixBody.classList.add("has-active");

      // Trigger map marker
      const entry = markerRegistry[station.station_id];
      if (entry) {
        entry.marker.openPopup();
        entry.marker.setStyle({
          radius: 11,
          weight: 3,
          fillOpacity: 1,
        });
      }
    });

    row.addEventListener("mouseleave", () => {
      row.classList.remove("row--active");
      DOM.matrixBody.classList.remove("has-active");

      const entry = markerRegistry[station.station_id];
      if (entry) {
        map.closePopup();
        entry.marker.setStyle({
          radius: statusKey === "ALERT" ? 8 : 7,
          weight: 2,
          fillOpacity: 0.85,
        });
      }
    });

    DOM.matrixBody.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   MAP MARKERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Clear existing markers and render new circleMarker vectors
 * for each station, colour-coded by status.  Binds cross-highlight
 * event handlers for Map → Matrix interaction.
 * @param {Array} stations
 */
function renderMapMarkers(stations) {
  // Remove old markers
  Object.values(markerRegistry).forEach(({ marker }) =>
    map.removeLayer(marker)
  );
  for (const key of Object.keys(markerRegistry)) {
    delete markerRegistry[key];
  }

  const bounds = [];

  stations.forEach((station) => {
    const { lat, lon } = station;
    if (lat == null || lon == null) return;

    const statusKey = (station.status || "SAFE").toUpperCase();
    const isAlert = statusKey === "ALERT";
    const isError = statusKey === "ERROR";

    // Resolve marker colour from CSS custom properties via theme tokens
    const markerColor = isAlert
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--status-alert")
          .trim()
      : isError
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--status-warn")
            .trim()
        : getComputedStyle(document.documentElement)
            .getPropertyValue("--status-safe")
            .trim();

    const marker = L.circleMarker([lat, lon], {
      radius: isAlert ? 8 : 7,
      fillColor: markerColor,
      color: markerColor,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85,
    }).addTo(map);

    // Build popup content
    const levelStr =
      station.water_level_m != null
        ? station.water_level_m.toFixed(2) + " m"
        : "N/A";
    const riverMatch = station.label.match(/\(([^)]+)\)/);
    const river = riverMatch ? riverMatch[1] : "";

    const popup = L.popup({
      closeButton: false,
      offset: [0, -6],
      className: "shs-popup",
    }).setContent(`
      <div class="popup-station">${escapeHtml(station.label)}</div>
      <div class="popup-river">${escapeHtml(river)}</div>
      <div class="popup-reading ${isAlert ? "is-alert" : "is-safe"}">${levelStr}</div>
      <div class="popup-threshold">Threshold: ${station.threshold_m.toFixed(2)} m · ${statusKey}</div>
    `);

    marker.bindPopup(popup);

    // ── Map → Matrix cross-highlight ─────────────────────────────
    marker.on("mouseover", () => {
      marker.openPopup();
      marker.setStyle({ radius: 11, weight: 3, fillOpacity: 1 });
      highlightMatrixRow(station.station_id, true);
    });

    marker.on("mouseout", () => {
      marker.closePopup();
      marker.setStyle({
        radius: isAlert ? 8 : 7,
        weight: 2,
        fillOpacity: 0.85,
      });
      highlightMatrixRow(station.station_id, false);
    });

    markerRegistry[station.station_id] = { marker, popup };
    bounds.push([lat, lon]);
  });

  // Fit map to show all markers and store bounds for reset control
  if (bounds.length > 0) {
    stationBounds = L.latLngBounds(bounds);
    map.fitBounds(stationBounds, { padding: [50, 50], maxZoom: 7 });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   CROSS-HIGHLIGHT HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Highlight (or unhighlight) a matrix row matching a station_id.
 * When a row is active, siblings are dimmed via the CSS
 * `.has-active tr:not(.row--active)` selector.
 * @param {string} stationId
 * @param {boolean} active
 */
function highlightMatrixRow(stationId, active) {
  const row = DOM.matrixBody.querySelector(
    `tr[data-station-id="${stationId}"]`
  );
  if (!row) return;

  if (active) {
    row.classList.add("row--active");
    DOM.matrixBody.classList.add("has-active");
    // Scroll into view without disrupting the page
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    row.classList.remove("row--active");
    DOM.matrixBody.classList.remove("has-active");
  }
}

/* ═══════════════════════════════════════════════════════════════════
   CLIENT-SIDE CSV EXPORT
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Compile the internal data state into a structured CSV and trigger
 * a browser download using the Blob API.  Zero backend required.
 */
function exportReport() {
  if (!lastFetchedData || !lastFetchedData.stations) {
    alert("No telemetry data loaded. Please wait for the feed to sync.");
    return;
  }

  const stations = lastFetchedData.stations;
  const generatedAt = lastFetchedData.generated_at || new Date().toISOString();

  // CSV header row
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

  // CSV data rows
  const rows = stations.map((s) => {
    const riverMatch = s.label.match(/\(([^)]+)\)/);
    const river = riverMatch ? riverMatch[1] : "—";
    const level =
      s.water_level_m != null ? s.water_level_m.toFixed(2) : "N/A";
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

  // Create blob and trigger download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

  link.href = url;
  link.download = `SerHydroSys_Report_${slug}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Format an ISO 8601 timestamp to a compact human-readable string
 * in the Europe/Berlin timezone.
 * @param {string} isoString
 * @returns {string}
 */
function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString("en-GB", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString || "—";
  }
}

/**
 * Shorter timestamp variant for the table column — time only.
 * @param {string} isoString
 * @returns {string}
 */
function formatTimestampShort(isoString) {
  try {
    return new Date(isoString).toLocaleString("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/**
 * Update the connection indicator in the header.
 * @param {"loading"|"live"|"error"} status
 */
function setConnectionStatus(status) {
  const el = DOM.connectionIndicator;
  el.classList.remove(
    "sys-status--loading",
    "sys-status--live",
    "sys-status--error"
  );

  const label = el.querySelector(".sys-label");
  switch (status) {
    case "loading":
      el.classList.add("sys-status--loading");
      label.textContent = "Syncing";
      break;
    case "live":
      el.classList.add("sys-status--live");
      label.textContent = "Live";
      break;
    case "error":
      el.classList.add("sys-status--error");
      label.textContent = "Offline";
      break;
  }
}

/**
 * Minimal HTML escaping to prevent XSS from station labels.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════
   INITIALISATION
   ═══════════════════════════════════════════════════════════════════ */

// 1. Resolve theme before any rendering
initTheme();

// 2. Initialise Leaflet map
initMap();

// 3. Wire up event listeners
DOM.exportBtn.addEventListener("click", exportReport);
DOM.themeToggle.addEventListener("click", toggleTheme);

// 4. Fetch data immediately
fetchStationData();

// 5. Auto-refresh on interval
setInterval(fetchStationData, REFRESH_INTERVAL_MS);
