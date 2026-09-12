"use client";

import { useEffect, useRef } from "react";
import { Station } from "@/types";
import styles from "./Matrix.module.css";

interface TelemetryMatrixProps {
  stations: Station[];
  loading: boolean;
  activeStationId: string | null;
  selectedStationId: string | null;
  onStationHover: (id: string | null) => void;
  onStationClick: (id: string | null) => void;
}

export default function TelemetryMatrix({
  stations,
  loading,
  activeStationId,
  selectedStationId,
  onStationHover,
  onStationClick,
}: TelemetryMatrixProps) {
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (!selectedStationId) return;
    const row = rowRefs.current[selectedStationId];
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedStationId]);

  return (
    <div className={styles.rail}>
      <div className={styles.railHeader}>
        <div className={styles.headerTitle}>Network Telemetry</div>
        <div className={styles.headerCount}>{stations.length} stations</div>
      </div>

      <div className={styles.scroll}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <span>Acquiring Telemetry…</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.thStatus} aria-label="Status"></th>
                <th className={styles.thStation}>Station</th>
                <th className={styles.thLevel}>Level</th>
                <th className={styles.thTrend}>Trend</th>
                <th className={styles.thForecast}>24h Pred</th>
                <th className={styles.thGauge}>Capacity</th>
                <th className={styles.thPrecip}>Precip</th>
              </tr>
            </thead>
            <tbody className={`${styles.tbody} ${activeStationId ? styles.hasActive : ""}`}>
              {stations.map((station) => {
                const statusKey = (station.status || "SAFE").toUpperCase();
                const level = station.water_level_m;
                const threshold = station.threshold_m;
                const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;

                const riverMatch = station.label.match(/\(([^)]+)\)/);
                const river = riverMatch ? riverMatch[1] : "—";
                const cleanName = station.label.replace(/\([^)]+\)/, "").trim();

                const levelStr = level != null ? level.toFixed(2) : "—";
                const pctStr = level != null ? pct.toFixed(0) : "—";

                const statusClass =
                  statusKey === "ALERT" ? "alert" : statusKey === "ERROR" ? "error" : "safe";

                const trend = station.trend || "stable";
                const isRising = trend === "rising";
                const isFalling = trend === "falling";

                const f24 = station.forecast_24h_m;
                const precip = station.precip_next_24h_mm || 0;
                const precipCond = station.precip_condition || "dry";

                const isActive = activeStationId === station.station_id;
                const isSelected = selectedStationId === station.station_id;

                return (
                  <tr
                    key={station.station_id}
                    ref={(el) => {
                      rowRefs.current[station.station_id] = el;
                    }}
                    className={`${styles.row} ${styles[`row--${statusClass}`]} ${
                      isActive ? styles.rowActive : ""
                    } ${isSelected ? styles.rowSelected : ""}`}
                    onMouseEnter={() => onStationHover(station.station_id)}
                    onMouseLeave={() => onStationHover(null)}
                    onClick={() => onStationClick(station.station_id)}
                  >
                    <td className={styles.tdStatus}>
                      <span className={`${styles.statusDot} ${styles[`statusDot--${statusClass}`]}`} />
                    </td>

                    <td className={styles.tdStation}>
                      <div className={styles.stationName}>{cleanName}</div>
                      <div className={styles.stationMeta}>{river} · {station.station_id}</div>
                    </td>

                    <td className={styles.tdLevel}>
                      <span className={`${styles.levelNum} ${styles[`level--${statusClass}`]}`}>
                        {levelStr}
                      </span>
                      <span className={styles.levelUnit}>m</span>
                    </td>

                    <td className={styles.tdTrend}>
                      {isRising ? (
                        <svg className={`${styles.trendIcon} ${styles.trendRising}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Rising">
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="7 7 17 7 17 17" />
                        </svg>
                      ) : isFalling ? (
                        <svg className={`${styles.trendIcon} ${styles.trendFalling}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Falling">
                          <line x1="7" y1="7" x2="17" y2="17" />
                          <polyline points="17 7 17 17 7 17" />
                        </svg>
                      ) : (
                        <svg className={`${styles.trendIcon} ${styles.trendStable}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Stable">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      )}
                    </td>

                    <td className={styles.tdForecast}>
                      {f24 != null ? (
                        <span className={styles.forecastNum}>{f24.toFixed(2)} m</span>
                      ) : (
                        <span className={styles.forecastMuted}>—</span>
                      )}
                    </td>

                    <td className={styles.tdGauge}>
                      <div className={styles.gaugeContainer}>
                        <div className={styles.gaugeTrack}>
                          <div
                            className={`${styles.gaugeFill} ${pct >= 100 ? styles.gaugeFillAlert : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={styles.gaugePct}>{pctStr}%</span>
                      </div>
                    </td>

                    <td className={styles.tdPrecip}>
                      {precip > 0 ? (
                        <span className={`${styles.precipVal} ${styles[`precip--${precipCond}`]}`}>
                          {precip.toFixed(1)} mm
                        </span>
                      ) : (
                        <span className={styles.precipNone}>—</span>
                      )}
                    </td>
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
