"use client";

import { useTheme } from "../ThemeProvider";
import { ConnectionStatus } from "@/hooks/useStationData";
import { exportReport } from "@/lib/csv-export";
import { SyncPayload } from "@/types";
import { BASE_PATH } from "@/lib/constants";
import styles from "./Header.module.css";

interface HeaderProps {
  status: ConnectionStatus;
  data: SyncPayload | null;
}

export default function Header({ status, data }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className={styles.appHeader}>
      <div className={styles.headerBar}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BASE_PATH}/pegelsync-mark.svg`}
              alt="PegelSync"
              width={28}
              height={28}
              style={{ borderRadius: 7, display: "block" }}
            />
          </span>
          <div className={styles.brandText}>
            <h1 className={styles.brandName}>PegelSync</h1>
            <span className={styles.brandSub}>Live River Telemetry & Forecast Network</span>
          </div>
        </div>

        <div className={styles.headerControls}>
          <span className={`${styles.sysStatus} ${styles[`sysStatus--${status}`]}`}>
            <span className={styles.sysDot}></span>
            <span className={styles.sysLabel}>
              {status === "loading" ? "Syncing" : status === "error" ? "Offline" : "Live"}
            </span>
          </span>

          <button
            className={styles.btnUtility}
            onClick={() => exportReport(data)}
            aria-label="Export station report as CSV"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export</span>
          </button>

          <button className={styles.btnIcon} onClick={toggleTheme} aria-label="Toggle light/dark theme">
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
