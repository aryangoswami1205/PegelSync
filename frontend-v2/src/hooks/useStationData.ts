"use client";

import { useState, useEffect } from "react";
import { SyncPayload } from "@/types";
import { S3_STATUS_URL, REFRESH_INTERVAL_MS } from "@/lib/constants";

export type ConnectionStatus = "loading" | "live" | "error";

export function useStationData() {
  const [data, setData] = useState<SyncPayload | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("loading");

  const fetchData = async () => {
    setStatus("loading");
    try {
      // In production this points to the S3 bucket URL.
      // During dev/testing, we fallback to the local file if testing locally.
      // Note: for a static export on GitHub pages, S3_STATUS_URL works relative.
      const response = await fetch(S3_STATUS_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      setData(json);
      setStatus("live");
    } catch (err) {
      console.error("[PegelSync] Fetch failed:", err);
      setStatus("error");
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { data, status, refresh: fetchData };
}
