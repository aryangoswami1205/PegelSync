"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  MapRef,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { useTheme } from "../ThemeProvider";
import { TILE_URLS } from "@/lib/constants";
import { Station, SyncPayload } from "@/types";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import KPIStrip from "../KPI/KPIStrip";

interface StationMapProps {
  data: SyncPayload | null;
  activeStationId: string | null;
  selectedStationId: string | null;
  onStationHover: (id: string | null) => void;
  onStationClick: (id: string | null) => void;
}

const INITIAL_VIEW_STATE = {
  longitude: 10.5,
  latitude: 51.0,
  zoom: 5.4,
};

function makeStyle(tileUrl: string) {
  return {
    version: 8 as const,
    sources: {
      carto: { type: "raster" as const, tiles: [tileUrl], tileSize: 256 },
    },
    layers: [
      { id: "carto-tiles", type: "raster" as const, source: "carto", minzoom: 0, maxzoom: 19 },
    ],
  };
}

export default function StationMap({
  data,
  activeStationId,
  selectedStationId,
  onStationHover,
  onStationClick,
}: StationMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { theme } = useTheme();
  const stations = data?.stations || [];

  const mapStyle = useMemo(
    () => makeStyle(theme === "dark" ? TILE_URLS.dark : TILE_URLS.light),
    [theme]
  );

  // Pan to station when activeStationId changes (driven by rail hover/click)
  useEffect(() => {
    if (!activeStationId || !mapRef.current) return;
    const station = stations.find((s) => s.station_id === activeStationId);
    if (!station) return;
    mapRef.current.flyTo({
      center: [station.lon, station.lat],
      zoom: Math.max(mapRef.current.getZoom(), 7),
      duration: 500,
      essential: true,
    });
  }, [activeStationId, stations]);

  // Fit bounds on first load
  const hasInitialFit = useRef(false);
  useEffect(() => {
    if (hasInitialFit.current || stations.length === 0 || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    stations.forEach((s) => bounds.extend([s.lon, s.lat]));
    mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 7 });
    hasInitialFit.current = true;
  }, [stations]);

  const handleResetView = useCallback(() => {
    if (stations.length === 0 || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    stations.forEach((s) => bounds.extend([s.lon, s.lat]));
    mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 7 });
  }, [stations]);

  function nodeColor(station: Station): string {
    if (station.status === "ALERT") return "var(--status-alert)";
    if (station.status === "ERROR") return "var(--status-warn)";
    return "var(--status-safe)";
  }

  const activeStation = stations.find((s) => s.station_id === selectedStationId || s.station_id === activeStationId);

  return (
    <div className={styles.mapPane}>
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapLib={maplibregl as any}
        mapStyle={mapStyle}
        reuseMaps
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
      >
        <NavigationControl position="top-left" showCompass={false} />

        <div className={styles.resetControl}>
          <button className={styles.resetButton} onClick={handleResetView} title="Reset view" aria-label="Reset map view">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>

        {stations.map((station) => {
          const isActive = activeStationId === station.station_id;
          const isSelected = selectedStationId === station.station_id;
          const color = nodeColor(station);
          const size = isSelected ? 20 : isActive ? 17 : 13;

          return (
            <Marker key={station.station_id} longitude={station.lon} latitude={station.lat} anchor="center">
              <button
                className={styles.nodeBtn}
                onMouseEnter={() => onStationHover(station.station_id)}
                onMouseLeave={() => onStationHover(null)}
                onClick={() => onStationClick(station.station_id)}
                aria-label={station.label}
              >
                <span
                  className={styles.nodeCore}
                  style={{ width: size, height: size, background: color, boxShadow: `0 0 12px ${color}` }}
                />
                <span className={styles.nodePing} style={{ borderColor: color }} />
                {isSelected && <span className={styles.nodeRing} style={{ borderColor: color }} />}
              </button>
            </Marker>
          );
        })}

        {activeStation && (
          <Popup
            longitude={activeStation.lon}
            latitude={activeStation.lat}
            anchor="bottom"
            offset={16}
            closeButton={false}
            closeOnClick={false}
            className={styles.popupWrapper}
          >
            <PopupContent station={activeStation} />
          </Popup>
        )}
      </MapGL>

      <KPIStrip data={data} />
    </div>
  );
}

function PopupContent({ station }: { station: Station }) {
  const isAlert = station.status === "ALERT";
  const levelStr = station.water_level_m != null ? station.water_level_m.toFixed(2) + " m" : "N/A";
  const riverMatch = station.label.match(/\(([^)]+)\)/);
  const river = riverMatch ? riverMatch[1] : "";
  const cleanName = station.label.replace(/\([^)]+\)/, "").trim();
  const rate = station.rate_of_change_cm_hr != null ? (station.rate_of_change_cm_hr > 0 ? "+" : "") + station.rate_of_change_cm_hr.toFixed(1) + " cm/hr" : "N/A";
  const discharge = station.discharge_m3s != null ? station.discharge_m3s.toFixed(1) + " m³/s" : "—";

  const f24 = station.forecast_24h_m;
  const f24lo = station.forecast_24h_lower_m;
  const f24hi = station.forecast_24h_upper_m;
  const trusted = station.forecast_ok && station.forecast_skill;

  return (
    <div className={styles.popupInner}>
      <div className={styles.popupStation}>{cleanName}</div>
      <div className={styles.popupRiver}>{river}</div>
      <div className={`${styles.popupReading} ${isAlert ? styles.isAlert : styles.isSafe}`}>{levelStr}</div>
      <div className={styles.popupMeta}>
        <span>Thr {station.threshold_m.toFixed(2)} m</span>
        <span>·</span>
        <span>{rate}</span>
      </div>
      <div className={styles.popupMeta} style={{ marginTop: 3 }}>Discharge {discharge}</div>
      <div className={styles.popupForecast}>
        {trusted ? (
          <>
            <div className={styles.popupForecastHead}>Predicted · 24h</div>
            <div className={styles.popupForecastRow}>
              <span>{f24 != null ? f24.toFixed(2) + " m" : "—"}</span>
              {f24lo != null && f24hi != null ? (
                <span className={styles.popupForecastPi}>[{f24lo.toFixed(2)}–{f24hi.toFixed(2)}]</span>
              ) : null}
            </div>
            <div className={styles.popupForecastNote}>90% interval · Local model</div>
          </>
        ) : (
          <div className={styles.popupForecastNote}>Forecast unavailable</div>
        )}
      </div>
    </div>
  );
}
