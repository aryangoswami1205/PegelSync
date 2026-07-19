import { SyncPayload } from "@/types";
import { formatTimestamp } from "@/lib/formatters";
import styles from "./KPI.module.css";

interface KPIStripProps {
  data: SyncPayload | null;
}

export default function KPIStrip({ data }: KPIStripProps) {
  const stations = data?.stations || [];
  const alertCount = stations.filter((s) => s.status === "ALERT").length;
  const precipRiskCount = stations.filter((s) => s.precip_next_24h_mm > 10).length;

  return (
    <div className={styles.kpiStrip}>
      <div className={styles.kpi}>
        <span className={styles.kpiValue}>{stations.length || "—"}</span>
        <span className={styles.kpiLabel}>Stations</span>
      </div>
      <div className={styles.kpiDivider}></div>
      <div className={styles.kpi}>
        <span
          className={styles.kpiValue}
          style={{ color: alertCount > 0 ? "var(--status-alert)" : "var(--accent-primary)" }}
        >
          {alertCount}
        </span>
        <span className={styles.kpiLabel}>Alerts</span>
      </div>
      <div className={styles.kpiDivider}></div>
      <div className={styles.kpi}>
        <span className={`${styles.kpiValue} ${styles.kpiValueTs}`}>
          {data ? formatTimestamp(data.generated_at) : "—"}
        </span>
        <span className={styles.kpiLabel}>Last Sync</span>
      </div>
      <div className={styles.kpiDivider}></div>
      <div className={styles.kpi}>
        <span
          className={styles.kpiValue}
          style={{ color: precipRiskCount > 0 ? "var(--status-warn)" : "var(--accent-primary)" }}
        >
          {precipRiskCount}
        </span>
        <span className={styles.kpiLabel}>Precip Risk</span>
      </div>
    </div>
  );
}
