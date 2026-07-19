"use client";

import { useEffect, useRef } from "react";
import { Station } from "@/types";
import { formatTimestampShort } from "@/lib/formatters";
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
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!selectedStationId) return;
    const el = rowRefs.current[selectedStationId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedStationId]);

  return (
    <div className={styles.rail}>
      <div className={styles.railHeader}>
        <span className={styles.railTitle}>Network Telemetry</span>
        <span className={styles.railCount}>{stations.length} stations</span>
      </div>

      <div className={styles.scroll}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <span>Acquiring Telemetry…</span>
          </div>
        ) : (
          <div className={stations.length ? styles.hasActive : ""}>
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
              const timeStr = formatTimestampShort(station.measurement_timestamp);

              const statusClass =
                statusKey === "ALERT" ? "alert" : statusKey === "ERROR" ? "error" : "safe";

              const trend = station.trend || "stable";
              const rotation = trend === "rising" ? "-45deg" : trend === "falling" ? "45deg" : "0deg";
              const isStable = trend === "stable";

              const trendSymbol = isStable ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rotation})` }}>
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              );

              const precip = station.precip_next_24h_mm || 0;
              const precipCond = station.precip_condition || "dry";
              const f24 = station.forecast_24h_m;
              const isActive = activeStationId === station.station_id;
              const isSelected = selectedStationId === station.station_id;

              return (
                <div
                  key={station.station_id}
                  ref={(el) => { rowRefs.current[station.station_id] = el; }}
                  className={`${styles.card} ${styles[`card--${statusClass}`]} ${isActive ? styles.cardActive : ""} ${isSelected ? styles.cardSelected : ""}`}
                  onMouseEnter={() => onStationHover(station.station_id)}
                  onMouseLeave={() => onStationHover(null)}
                  onClick={() => onStationClick(station.station_id)}
                >
                  <span className={`${styles.pip} ${styles[`pip--${statusClass}`]}`}></span>

                  <div className={styles.cardTop}>
                    <div className={styles.identity}>
                      <div className={styles.name}>{cleanName}</div>
                      <div className={styles.river}>{river} · {station.station_id}</div>
                    </div>
                    <span className={`${styles.trend} ${styles[trend]}`}>{trendSymbol}</span>
                  </div>

                  <div className={styles.cardMid}>
                    <div className={styles.level}>
                      <span className={styles.levelVal}>{levelStr}</span>
                      <span className={styles.levelUnit}>m</span>
                    </div>
                    <div className={styles.cardRight}>
                      {precip > 0 ? (
                        <span className={`${styles.precip} ${styles[`precip--${precipCond}`]}`}>💧 {precip.toFixed(1)}mm</span>
                      ) : (
                        <span className={styles.precipNone}>—</span>
                      )}
                      <span className={styles.thr}>{threshold.toFixed(2)} m thr</span>
                    </div>
                  </div>

                  <div className={styles.gauge}>
                    <div className={styles.gaugeTrack}>
                      <div className={`${styles.gaugeFill} ${pct >= 100 ? styles.gaugeFillAlert : ""}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={styles.gaugePct}>{pctStr}%</span>
                  </div>

                  <div className={styles.cardFoot}>
                    <span className={styles.fcBadge}>
                      24h ▸ {f24 != null ? f24.toFixed(2) + " m" : "—"}
                    </span>
                    <span className={styles.time}>{timeStr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
