"use client";

import { useEffect, useRef, useState } from "react";
import { Station } from "@/types";
import { formatTimestamp, formatTimestampShort } from "@/lib/formatters";
import styles from "./StationDrawer.module.css";

interface StationDrawerProps {
  station: Station | null;
  onClose: () => void;
}

/** Animated count-up number */
function useCountUp(value: number | null, duration = 600) {
  const [display, setDisplay] = useState(value ?? 0);
  const fromRef = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) { setDisplay(0); return; }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

export default function StationDrawer({ station, onClose }: StationDrawerProps) {
  const open = station != null;
  const animLevel = useCountUp(station?.water_level_m ?? null);

  // Lock scroll behind drawer
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!station) return null;

  const level = station.water_level_m;
  const threshold = station.threshold_m;
  const pct = level != null ? Math.min((level / threshold) * 100, 100) : 0;
  const riverMatch = station.label.match(/\(([^)]+)\)/);
  const river = riverMatch ? riverMatch[1] : "";
  const cleanName = station.label.replace(/\([^)]+\)/, "").trim();

  const trend = station.trend || "stable";
  const trendLabel = trend === "rising" ? "Rising" : trend === "falling" ? "Falling" : "Stable";
  const trendColor = trend === "rising" ? "var(--status-alert)" : trend === "falling" ? "var(--accent-primary)" : "var(--text-secondary)";

  const trusted = station.forecast_ok && station.forecast_skill;
  const f6 = station.forecast_6h_m;
  const f12 = station.forecast_12h_m;
  const f24 = station.forecast_24h_m;
  const f48 = station.forecast_48h_m;
  const lo = station.forecast_24h_lower_m;
  const hi = station.forecast_24h_upper_m;

  // Fan-chart scale: max of threshold, hi, current, with 10% headroom
  const scaleMax = Math.max(threshold, hi ?? 0, level ?? 0, f24 ?? 0) * 1.1 || 1;
  const y = (v: number | null) => (v == null ? 0 : `${(1 - v / scaleMax) * 100}%`);

  const isAlert = station.status === "ALERT";

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-label={`${cleanName} details`}>
        <div className={styles.head}>
          <div>
            <div className={styles.dTitle}>{cleanName}</div>
            <div className={styles.dRiver}>{river} · {station.station_id}</div>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.hero}>
          <div className={`${styles.heroLevel} ${isAlert ? styles.heroAlert : ""}`}>
            <span className={styles.heroVal}>{animLevel.toFixed(2)}</span>
            <span className={styles.heroUnit}>m</span>
          </div>
          <div className={styles.heroMeta}>
            <span className={styles.trendTag} style={{ color: trendColor, background: "color-mix(in srgb, currentColor 14%, transparent)" }}>
              {trendLabel}
            </span>
            <span className={styles.heroThr}>Threshold {threshold.toFixed(2)} m</span>
          </div>
        </div>

        <div className={styles.capacity}>
          <div className={styles.capTrack}>
            <div className={`${styles.capFill} ${pct >= 100 ? styles.capFillAlert : ""}`} style={{ width: `${pct}%` }} />
            <div className={styles.capThr} style={{ left: "100%" }} title="Threshold" />
          </div>
          <div className={styles.capLabels}>
            <span>{pct.toFixed(0)}% of threshold</span>
            <span>Status: {station.status}</span>
          </div>
        </div>

        <div className={styles.stats}>
          <Stat label="Discharge" value={station.discharge_m3s != null ? station.discharge_m3s.toFixed(1) : "—"} unit="m³/s" />
          <Stat label="Rate" value={station.rate_of_change_cm_hr != null ? (station.rate_of_change_cm_hr > 0 ? "+" : "") + station.rate_of_change_cm_hr.toFixed(1) : "—"} unit="cm/hr" />
          <Stat label="Precip 24h" value={station.precip_next_24h_mm.toFixed(1)} unit="mm" />
          <Stat label="Updated" value={formatTimestampShort(station.measurement_timestamp)} unit="" />
        </div>

        <div className={styles.forecast}>
          <div className={styles.fcHead}>
            <span>Forecast · 90% prediction interval</span>
            <span className={styles.fcSrc}>{trusted ? "Local model" : "n/a"}</span>
          </div>

          {trusted ? (
            <div className={styles.fan}>
              <div className={styles.fanChart}>
                <div className={styles.fcBand} style={{ top: y(hi), height: `calc(${y(lo)} - ${y(hi)})` }} />
                <div className={styles.fcThrLine} style={{ top: y(threshold) }} />
                <div className={styles.fcNow} style={{ top: y(level) }}>
                  <span className={styles.fcNowDot} />
                  <span className={styles.fcNowLbl}>now</span>
                </div>
                <div className={styles.fcF24} style={{ top: y(f24) }}>
                  <span className={styles.fcF24Dot} />
                  <span className={styles.fcF24Lbl}>{f24 != null ? f24.toFixed(2) + "m" : "—"}</span>
                </div>
              </div>
              <div className={styles.fcList}>
                <FcPoint h="6h" v={f6} />
                <FcPoint h="12h" v={f12} />
                <FcPoint h="24h" v={f24} sub={lo != null && hi != null ? `±${((hi - lo) / 2).toFixed(2)}m` : undefined} />
                <FcPoint h="48h" v={f48} />
              </div>
            </div>
          ) : (
            <div className={styles.fcUnavail}>Forecast unavailable — insufficient history to size prediction intervals.</div>
          )}
        </div>

        <div className={styles.foot}>
          <span>Synced {formatTimestamp(station.measurement_timestamp)}</span>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statVal}>{value}<span className={styles.statUnit}>{unit}</span></div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function FcPoint({ h, v, sub }: { h: string; v: number | null; sub?: string }) {
  return (
    <div className={styles.fcRow}>
      <span className={styles.fcRowH}>{h}</span>
      <span className={styles.fcRowV}>{v != null ? v.toFixed(2) + " m" : "—"}</span>
      {sub ? <span className={styles.fcRowSub}>{sub}</span> : <span className={styles.fcRowSub} />}
    </div>
  );
}
