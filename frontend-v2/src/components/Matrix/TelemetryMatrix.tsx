"use client";

import { useEffect, useRef } from "react";
import { Station } from "@/types";
import { formatTimestampShort } from "@/lib/formatters";
import styles from "./Matrix.module.css";

interface TelemetryMatrixProps {
  stations: Station[];
  loading: boolean;
  activeStationId: string | null;
  onStationHover: (id: string | null) => void;
}

export default function TelemetryMatrix({
  stations,
  loading,
  activeStationId,
  onStationHover,
}: TelemetryMatrixProps) {
  // Ref map: station_id → row element, for scrollIntoView
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // When activeStationId changes (e.g. from map hover), scroll the row into view
  useEffect(() => {
    if (!activeStationId) return;
    const row = rowRefs.current[activeStationId];
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeStationId]);

  return (
    <div className={styles.matrixPane}>
      <div className={styles.matrixHeader}>
        <div className={styles.matrixTitle}>Network Telemetry</div>
        <div className={styles.matrixCount}>
          {stations.length} station{stations.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className={styles.matrixScroll}>
        {loading ? (
          <div className={styles.matrixLoading}>
            <div className={styles.spinner}></div>
            <span>Acquiring Telemetry...</span>
          </div>
        ) : (
          <table className={styles.matrixTable}>
            <thead>
              <tr>
                <th className={styles.colStatus}></th>
                <th className={styles.colStation}>Station</th>
                <th className={styles.colLevel}>Level</th>
                <th className={styles.colTrend}>Trend</th>
                <th className={styles.colPrecip}>Forecast</th>
                <th className={styles.colThreshold}>Threshold</th>
                <th className={styles.colGauge}>Capacity</th>
                <th className={styles.colTime}>Time</th>
              </tr>
            </thead>
            <tbody className={activeStationId ? styles.hasActive : ""}>
              {stations.map((station) => {
                const statusKey = (station.status || "SAFE").toUpperCase();
                const level = station.water_level_m;
                const threshold = station.threshold_m;
                const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;

                const riverMatch = station.label.match(/\(([^)]+)\)/);
                const river = riverMatch ? riverMatch[1] : "—";
                const cleanName = station.label.replace(/\([^)]+\)/, "").trim();

                const levelStr = level != null ? level.toFixed(2) : "—";
                const thresholdStr = threshold.toFixed(2);
                const pctStr = level != null ? pct.toFixed(0) : "—";
                const timeStr = formatTimestampShort(station.measurement_timestamp);

                const statusClass =
                  statusKey === "ALERT"
                    ? "alert"
                    : statusKey === "ERROR"
                    ? "error"
                    : "safe";

                const trend = station.trend || "stable";
                const rotation = trend === "rising" ? "-45deg" : trend === "falling" ? "45deg" : "0deg";
                const isStable = trend === "stable";

                const trendSymbol = isStable ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rotation})` }}>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                );

                const precip = station.precip_next_24h_mm || 0;
                const precipCond = station.precip_condition || "dry";

                const isActive = activeStationId === station.station_id;

                return (
                  <tr
                    key={station.station_id}
                    ref={(el) => { rowRefs.current[station.station_id] = el; }}
                    className={isActive ? styles.rowActive : ""}
                    onMouseEnter={() => onStationHover(station.station_id)}
                    onMouseLeave={() => onStationHover(null)}
                  >
                    <td className={`${styles.tdStatus} ${styles.colStatus}`}>
                      <span className={`${styles.statusPip} ${styles[`statusPip--${statusClass}`]}`}></span>
                    </td>
                    <td className={styles.colStation}>
                      <div className={styles.tdStationName}>{cleanName}</div>
                      <div className={styles.tdStationRiver}>{river} · {station.station_id}</div>
                    </td>
                    <td className={`${styles.colLevel} ${styles.tdNumeric} ${styles[`is-${statusClass}`]}`}>
                      {levelStr}<span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "2px" }}>m</span>
                    </td>
                    <td className={styles.colTrend}>
                      <span className={`${styles.trendArrow} ${styles[trend]}`}>{trendSymbol}</span>
                    </td>
                    <td className={styles.colPrecip}>
                      {precip > 0 ? (
                        <span className={`${styles.precipBadge} ${styles[`is-${precipCond}`]}`}>
                          💧 {precip.toFixed(1)}mm
                        </span>
                      ) : (
                        <span className={styles.precipBadge} style={{ background: "transparent", border: "none" }}>--</span>
                      )}
                    </td>
                    <td className={`${styles.colThreshold} ${styles.tdThreshold}`}>
                      {thresholdStr} m
                    </td>
                    <td className={styles.colGauge}>
                      <div className={styles.gaugeContainer}>
                        <div className={styles.gaugeTrack}>
                          <div
                            className={`${styles.gaugeFill} ${pct >= 100 ? styles.gaugeFillAlert : ""}`}
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                        <span className={styles.gaugePct}>{pctStr}%</span>
                      </div>
                    </td>
                    <td className={`${styles.colTime} ${styles.tdTime}`}>{timeStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
