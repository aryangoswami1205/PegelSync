"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onStationHover: (id: string | null) => void;
}

const INITIAL_VIEW_STATE = {
  longitude: 10.5,
  latitude: 51.0,
  zoom: 5.5,
};

/** Build a MapLibre raster style object from a tile URL */
function makeStyle(tileUrl: string) {
  return {
    version: 8 as const,
    sources: {
      carto: {
        type: "raster" as const,
        tiles: [tileUrl],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "carto-tiles",
        type: "raster" as const,
        source: "carto",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}

export default function StationMap({
  data,
  activeStationId,
  onStationHover,
}: StationMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { theme } = useTheme();
  const stations = data?.stations || [];

  // Memoize the style object so MapLibre doesn't reload on every render
  const mapStyle = useMemo(
    () => makeStyle(theme === "dark" ? TILE_URLS.dark : TILE_URLS.light),
    [theme]
  );

  // ── Pan to station when activeStationId changes (driven by matrix hover) ──
  useEffect(() => {
    if (!activeStationId || !mapRef.current) return;
    const station = stations.find((s) => s.station_id === activeStationId);
    if (!station) return;
    mapRef.current.flyTo({
      center: [station.lon, station.lat],
      duration: 350,
      essential: true,
    });
  }, [activeStationId, stations]);

  // ── Fit bounds to all stations on first data load ──
  const hasInitialFit = useRef(false);
  useEffect(() => {
    if (hasInitialFit.current || stations.length === 0 || !mapRef.current)
      return;
    const bounds = new maplibregl.LngLatBounds();
    stations.forEach((s) => bounds.extend([s.lon, s.lat]));
    mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 7 });
    hasInitialFit.current = true;
  }, [stations]);

  // ── Reset view handler ──
  const handleResetView = useCallback(() => {
    if (stations.length === 0 || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    stations.forEach((s) => bounds.extend([s.lon, s.lat]));
    mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 7 });
  }, [stations]);

  // ── Resolve marker color from status ──
  function markerColor(station: Station): string {
    if (station.status === "ALERT")
      return theme === "dark"
        ? "var(--status-alert)"
        : "var(--status-alert)";
    if (station.status === "ERROR")
      return theme === "dark"
        ? "var(--status-warn)"
        : "var(--status-warn)";
    return theme === "dark"
      ? "var(--status-safe)"
      : "var(--status-safe)";
  }

  // ── Build popup content for the active station ──
  const activeStation = stations.find(
    (s) => s.station_id === activeStationId
  );

  return (
    <div className={styles.mapPane}>
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapLib={maplibregl as any}
        mapStyle={mapStyle}
        reuseMaps
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-left" />

        {/* Reset View button */}
        <div className={styles.resetControl}>
          <button
            className={styles.resetButton}
            onClick={handleResetView}
            title="Reset view to show all stations"
            aria-label="Reset map view"
          >
            ⌂
          </button>
        </div>

        {/* Station markers */}
        {stations.map((station) => {
          const isActive = activeStationId === station.station_id;
          const isAlert = station.status === "ALERT";
          const size = isActive ? 22 : isAlert ? 16 : 14;

          return (
            <Marker
              key={station.station_id}
              longitude={station.lon}
              latitude={station.lat}
              anchor="center"
            >
              <div
                className={`${styles.stationDot} ${isActive ? styles.stationDotActive : ""}`}
                style={{
                  width: size,
                  height: size,
                  backgroundColor: markerColor(station),
                  boxShadow: isActive
                    ? `0 0 12px ${markerColor(station)}`
                    : `0 0 5px color-mix(in srgb, ${markerColor(station)} 40%, transparent)`,
                }}
                onMouseEnter={() => onStationHover(station.station_id)}
                onMouseLeave={() => onStationHover(null)}
              />
            </Marker>
          );
        })}

        {/* Popup for active station */}
        {activeStation && (
          <Popup
            longitude={activeStation.lon}
            latitude={activeStation.lat}
            anchor="bottom"
            offset={14}
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

/** Self-contained popup content component */
function PopupContent({ station }: { station: Station }) {
  const isAlert = station.status === "ALERT";
  const levelStr =
    station.water_level_m != null
      ? station.water_level_m.toFixed(2) + " m"
      : "N/A";
  const riverMatch = station.label.match(/\(([^)]+)\)/);
  const river = riverMatch ? riverMatch[1] : "";
  const cleanName = station.label.replace(/\([^)]+\)/, "").trim();

  const rateOfChange =
    station.rate_of_change_cm_hr != null
      ? (station.rate_of_change_cm_hr > 0 ? "+" : "") +
        station.rate_of_change_cm_hr.toFixed(1) +
        " cm/hr"
      : "N/A";
  const discharge =
    station.discharge_m3s != null
      ? station.discharge_m3s.toFixed(1) + " m³/s"
      : "—";

  // ── Phase 5 forecast summary ──
  const f6 = station.forecast_6h_m;
  const f24 = station.forecast_24h_m;
  const f24lo = station.forecast_24h_lower_m;
  const f24hi = station.forecast_24h_upper_m;
  const trusted = station.forecast_ok && station.forecast_skill;

  return (
    <div className={styles.popupInner}>
      <div className={styles.popupStation}>{cleanName}</div>
      <div className={styles.popupRiver}>{river}</div>
      <div
        className={`${styles.popupReading} ${isAlert ? styles.isAlert : styles.isSafe}`}
      >
        {levelStr}
      </div>
      <div className={styles.popupThreshold}>
        Threshold: {station.threshold_m.toFixed(2)} m · {station.status}
      </div>
      <div
        className={styles.popupThreshold}
        style={{ marginTop: "4px", fontWeight: 500 }}
      >
        Rate: {rateOfChange} · Discharge: {discharge}
      </div>
      <div className={styles.popupForecast}>
        {trusted ? (
          <>
            <div className={styles.popupForecastHead}>Predicted level</div>
            <div className={styles.popupForecastRow}>
              <span>6h</span>
              <span>{f6 != null ? f6.toFixed(2) + " m" : "—"}</span>
            </div>
            <div className={styles.popupForecastRow}>
              <span>24h</span>
              <span>
                {f24 != null ? f24.toFixed(2) + " m" : "—"}
                {f24lo != null && f24hi != null ? (
                  <span className={styles.popupForecastPi}>
                    {" "}
                    [{f24lo.toFixed(2)}–{f24hi.toFixed(2)}]
                  </span>
                ) : null}
              </span>
            </div>
            <div className={styles.popupForecastNote}>
              90% prediction interval
            </div>
          </>
        ) : (
          <div className={styles.popupForecastNote}>
            Forecast unavailable (insufficient history)
          </div>
        )}
      </div>
    </div>
  );
}
